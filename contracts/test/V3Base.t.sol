// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {QuantumCatchV3, ISqk} from "../src/QuantumCatchV3.sol";
import {Card, Dna, IS2Renderer} from "../src/S2Types.sol";

/// a renderer that answers with a fixed text and maps every caught net to skin 1, items all 1 (for game tests that do
/// not need the art)
contract MockRenderer is IS2Renderer {
    string public tag;

    constructor(string memory tag_) {
        tag = tag_;
    }

    function tokenURI(Card calldata c, Dna calldata d) external view returns (string memory) {
        return string.concat(tag, ":", vm_toString(c.status), ":", vm_toString(d.tier), ":", vm_toString(c.spot));
    }

    function itemsOf(Dna calldata d) external pure returns (uint8 skin, uint8[10] memory items) {
        if (d.status != 1) return (skin, items);
        skin = 1;
        for (uint256 k; k < 10; ++k) {
            items[k] = d.tiers[k];
        }
    }

    function vm_toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory b;
        for (; v != 0; v /= 10) {
            b = abi.encodePacked(bytes1(uint8(48 + (v % 10))), b);
        }
        return string(b);
    }
}

/// a renderer that always reverts
contract RevertingRenderer is IS2Renderer {
    function tokenURI(Card calldata, Dna calldata) external pure returns (string memory) {
        revert("broken");
    }

    function itemsOf(Dna calldata) external pure returns (uint8, uint8[10] memory) {
        revert("broken");
    }
}

abstract contract V3Base is Test {
    // night of 2026-11-04 (Squeek day 4 Nov 12:00 UTC -> 5 Nov 12:00 UTC)
    uint32 internal constant N1104 = 20761;
    uint32 internal constant TURNS_1104 = 3817;
    uint8 internal constant STEPS_V12 = 10;
    bytes32 internal constant JOB_1104 = "dbmbr0hkbkrc73cp7u8g";
    bytes32 internal constant SHA_1104 = keccak256("stand-in for the file sha256");
    uint8 internal constant FIRST_1104_V12 = 3; // v1.2: position 10 + 3817
    /// the tests post at this block; the block after it has this hash; the seal comes two blocks after the post
    uint256 internal constant POST_BLOCK = 1000;
    bytes32 internal constant BH = keccak256("Quantum Catch S2 test block");

    address internal hatcher = makeAddr("hatcher");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    QuantumCatchV3 internal qc;
    MockRenderer internal mock;

    function setUp() public virtual {
        mock = new MockRenderer("mock");
        qc = new QuantumCatchV3(hatcher, mock, ISqk(address(0)), 0);
        vm.warp(qc.nightStart(N1104) + 3600); // 13:00 UTC on 4 Nov: nets for the night of 4 Nov are open
    }

    // recipe v1.2 run of the night of 4 Nov (job dbmbr0hkbkrc73cp7u8g): 10 steps, 3817 turns, per SPOT
    function _counts1104v12() internal pure returns (uint16[16] memory c) {
        c = [uint16(40), 679, 55, 493, 46, 504, 29, 254, 44, 380, 34, 260, 33, 578, 46, 525];
    }

    function _cast(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = qc.castNet();
    }

    function _id(uint32 n, address who) internal pure returns (uint256) {
        return (uint256(n) << 160) | uint160(who);
    }

    /// the seed of a night posted with sha / job and sealed by the block hash BH (the tests' post-then-seal)
    function _seed(bytes32 sha, bytes32 job) internal pure returns (bytes32) {
        return keccak256(abi.encode(BH, sha, job));
    }

    /// post night n at POST_BLOCK (the clock at its end), then seal it two blocks later with block POST_BLOCK + 1's
    /// hash = BH
    function _postSeal(uint32 n, uint16[16] memory c, uint32 turns, uint8 steps, uint8 first, bytes32 job, bytes32 sha)
        internal
        returns (bytes32 seed)
    {
        _post(n, c, turns, steps, first, job, sha);
        seed = _sealNow(n);
    }

    function _post(uint32 n, uint16[16] memory c, uint32 turns, uint8 steps, uint8 first, bytes32 job, bytes32 sha)
        internal
    {
        if (block.timestamp < qc.nightOverAt(n)) vm.warp(qc.nightOverAt(n));
        vm.roll(POST_BLOCK);
        vm.prank(hatcher);
        qc.postNight(n, c, turns, steps, job, sha, first);
    }

    function _sealNow(uint32 n) internal returns (bytes32) {
        vm.roll(POST_BLOCK + 2);
        vm.setBlockhash(POST_BLOCK + 1, BH);
        return qc.seal(n);
    }

    function _post1104(uint16[16] memory c, uint8 first) internal returns (bytes32) {
        return _postSeal(N1104, c, TURNS_1104, STEPS_V12, first, JOB_1104, SHA_1104);
    }

    // ---- the draw, written here independently of the contract: a running sum ----

    function _refWalk(uint16[16] memory c, uint256 w) internal pure returns (uint8) {
        uint256 shots;
        for (uint256 s; s < 16; ++s) {
            shots += c[s];
        }
        uint256 x = w % shots;
        uint256 sum;
        for (uint256 s; s < 16; ++s) {
            sum += c[s];
            if (x < sum) return uint8(s);
        }
        revert("unreachable");
    }

    function _refDraw(uint32 n, bytes32 seed, uint256 id, uint16[16] memory c) internal pure returns (uint8) {
        return _refWalk(c, uint256(keccak256(abi.encode(n, seed, id))));
    }

    uint256 internal _nextCaster = 0x5EED00000000;

    /// a fresh caster whose net for night n draws `spot` under `seed`
    function _casterFor(uint32 n, uint8 spot, uint16[16] memory c, bytes32 seed) internal returns (address who) {
        require(spot < 16 && c[spot] > 0, "a spot without landings is never drawn");
        for (uint256 i; i < 100_000; ++i) {
            who = address(uint160(_nextCaster++));
            if (_refDraw(n, seed, _id(n, who), c) == spot) return who;
        }
        revert("no caster found");
    }

    /// cast, for the open night, a net that draws `spot` once the night is posted with c and sealed (JOB_1104, SHA_1104)
    function _castOn(uint8 spot, uint16[16] memory c) internal returns (uint256) {
        return _cast(_casterFor(qc.openNight(), spot, c, _seed(SHA_1104, JOB_1104)));
    }

    // ---- the rarity rule, independently: a walk and a plain sort ----

    function _walkReach(uint256 spot, uint256 turns, uint256 k) internal pure returns (bool) {
        int256 start = int256(turns % 16);
        for (int256 x = -int256(k); x <= int256(k); x += 2) {
            if (uint256(((start + x) % 16 + 16) % 16) == spot) return true;
        }
        return false;
    }

    function _refTiers(uint16[16] memory c, uint256 turns, uint256 steps, uint8 first)
        internal
        pure
        returns (uint8[16] memory t)
    {
        uint256 shots;
        for (uint256 s; s < 16; ++s) {
            shots += c[s];
        }
        uint8[16] memory order;
        uint256 n;
        for (uint256 s; s < 16; ++s) {
            if (shots > 0 && _walkReach(s, turns, steps) && uint256(c[s]) * 100 >= shots) order[n++] = uint8(s);
        }
        for (uint256 i = 1; i < n; ++i) {
            uint8 x = order[i];
            uint256 j = i;
            while (j > 0 && c[order[j - 1]] < c[x]) {
                order[j] = order[j - 1];
                --j;
            }
            order[j] = x;
        }
        for (uint256 r = 1; r <= n; ++r) {
            uint8 s = order[r - 1];
            t[s] = r == n ? (s == first ? 5 : 4) : r == n - 1 ? 3 : r + 3 >= n ? 2 : 1;
        }
    }

    function _dnaKey(Dna memory d) internal pure returns (bytes32) {
        return keccak256(abi.encode(d));
    }
}
