// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {QuantumCatch, IPaintedArt, ISqk} from "../src/QuantumCatch.sol";

abstract contract CatchBase is Test {
    // night of 2026-11-04 (Squeek day 4 Nov 12:00 UTC -> 5 Nov 12:00 UTC), the first healthy chip night
    uint32 internal constant N1104 = 20761;
    uint256 internal constant START_1104 = 1793793600; // 2026-11-04 12:00 UTC
    uint256 internal constant LOCK_1104 = 1793826000; // 2026-11-04 21:00 UTC: nets close
    uint256 internal constant OVER_1104 = 1793880000; // 2026-11-05 12:00 UTC: night over, the chip result can be posted

    // the real chip run of 4 Nov (ibm_marrakesh, job dbmaa9u74qds73dru4d0), per SPOT after the ring turn (3817 turns -> 9)
    uint32 internal constant TURNS_1104 = 3817;
    uint8 internal constant STEPS_1104 = 14; // recipe v1 (16-step cap): 14 active rounds
    bytes32 internal constant JOB_1104 = "dbmaa9u74qds73dru4d0";
    bytes32 internal constant SHA_1104 = keccak256("stand-in for the file sha256");
    // the chip's very first shot of each real night, turned onto the ring ((shots_in_order[0] + turns) % 16)
    uint8 internal constant FIRST_1104 = 15; // v1: position 6 + 3817
    uint8 internal constant FIRST_1104_V12 = 3; // v1.2: position 10 + 3817
    uint8 internal constant FIRST_1031 = 13; // v1: position 4 + 8505
    uint8 internal constant FIRST_1101_V12 = 1; // v1.2: position 9 + 8984 (out of reach that night)
    IPaintedArt internal constant NO_ART = IPaintedArt(address(0));
    ISqk internal constant NO_SQK = ISqk(address(0)); // free nets (the v1 game): every older test means the same

    address internal hatcher = makeAddr("hatcher");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    QuantumCatch internal qc;

    function setUp() public virtual {
        qc = new QuantumCatch(hatcher, NO_ART, NO_SQK, 0);
        vm.warp(START_1104 + 3600); // 13:00 UTC on 4 Nov: nets for the night of 4 Nov are open
    }

    function _counts1104() internal pure returns (uint16[16] memory c) {
        c = [
            uint16(27), 693, 22, 705, 25, 308, 19, 368, 18, 383, 18, 289, 12, 292, 13, 808
        ];
    }

    // recipe v1 archive night of 31 Oct (ibm_marrakesh, job dbmbiau74qds73ds0hug): 16 steps, 8505 turns (ring turn 9),
    // per SPOT. After 16 steps with 8505 turns only odd spots are in reach; the even ones got 46-98 landings from chip
    // noise alone (1 % to 2.5 % of the shots). Out of reach never catches: those nets got away.
    uint32 internal constant N1031 = 20757;
    uint32 internal constant TURNS_1031 = 8505;
    uint8 internal constant STEPS_1031 = 16;

    function _counts1031() internal pure returns (uint16[16] memory c) {
        c = [uint16(46), 231, 51, 353, 47, 758, 75, 770, 98, 250, 47, 485, 72, 419, 96, 202];
    }

    // recipe v1.2 run of the night of 4 Nov (ibm_marrakesh, job dbmbr0hkbkrc73cp7u8g): 10 steps, 3817 turns, per SPOT.
    // Odd spots in reach (all caught, 6.4 % to 17 %); the even spots got 29-55 landings from chip noise alone (spots 0,
    // 2, 4, 8, 14 at >= 1 %): out of reach, so they got away.
    uint8 internal constant STEPS_1104_V12 = 10;

    function _counts1104v12() internal pure returns (uint16[16] memory c) {
        c = [uint16(40), 679, 55, 493, 46, 504, 29, 254, 44, 380, 34, 260, 33, 578, 46, 525];
    }

    // recipe v1.2 re-run of the night of 1 Nov (ibm_marrakesh, job dbmbr2m74qds73ds11j0): 10 steps, 8984 turns (ring
    // turn 8), per SPOT. Even spots in reach (all caught, 6.1 % to 15 %); the odd spots got 16-53 landings from chip
    // noise alone (spots 3, 5, 7, 11, 13, 15 at >= 1 %): out of reach, so they got away.
    uint32 internal constant N1101 = 20758;
    uint32 internal constant TURNS_1101 = 8984;
    uint8 internal constant STEPS_1101_V12 = 10;

    function _counts1101v12() internal pure returns (uint16[16] memory c) {
        c = [uint16(244), 30, 496, 52, 491, 53, 593, 48, 286, 16, 539, 52, 489, 47, 514, 50];
    }

    /// `who` casts its net for the open night (no spot: the night's result draws it)
    function _cast(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = qc.castNet();
    }

    // ---- the draw (the owner's rule, 6 Nov), written here independently of the contract: a running sum ----

    /// the spot of the shot drawn for net `id` of night n: x = keccak256(abi.encode(n, sha, job, id)) mod the shots,
    /// the first spot whose running sum of landings passes x; 255 when nothing landed
    function _refDraw(uint32 n, bytes32 sha, bytes32 job, uint256 id, uint16[16] memory c) internal pure returns (uint8) {
        uint256 shots;
        for (uint256 s; s < 16; ++s) {
            shots += c[s];
        }
        if (shots == 0) return 255;
        uint256 x = uint256(keccak256(abi.encode(n, sha, job, id))) % shots;
        uint256 sum;
        for (uint256 s; s < 16; ++s) {
            sum += c[s];
            if (x < sum) return uint8(s);
        }
        revert("unreachable");
    }

    function _id(uint32 n, address who) internal pure returns (uint256) {
        return (uint256(n) << 160) | uint160(who);
    }

    /// the next fresh test caster (never the hatcher, never a precompile or a cheat code address)
    uint256 internal _nextCaster = 0x5EED00000000;

    /// a fresh caster whose net for night n draws `spot` when night n is posted with counts c, job and sha
    function _casterFor(uint32 n, uint8 spot, uint16[16] memory c, bytes32 job, bytes32 sha)
        internal
        returns (address who)
    {
        require(spot < 16 && c[spot] > 0, "a spot without landings is never drawn");
        for (uint256 i; i < 100_000; ++i) {
            who = address(uint160(_nextCaster++));
            if (_refDraw(n, sha, job, _id(n, who), c) == spot) return who;
        }
        revert("no caster found");
    }

    /// cast, for the open night, a net that draws `spot` once the night is posted with counts c (and the tests' usual
    /// JOB_1104 / SHA_1104, as _post / _postK / _postF post them)
    function _castOn(uint8 spot, uint16[16] memory c) internal returns (uint256) {
        return _castOnJ(spot, c, JOB_1104, SHA_1104);
    }

    function _castOnJ(uint8 spot, uint16[16] memory c, bytes32 job, bytes32 sha) internal returns (uint256) {
        return _cast(_casterFor(qc.openNight(), spot, c, job, sha));
    }

    /// for the open night, one net per spot that has landings in c: ids[s] draws spot s once the night is posted with c
    /// (JOB_1104 / SHA_1104); ids[s] = 0 for a spot without landings (never drawn). Fresh casters in order, each taken
    /// for the first spot it draws that has no net yet.
    function _castEvery(uint16[16] memory c) internal returns (uint256[16] memory ids) {
        uint32 n = qc.openNight();
        uint256 need;
        for (uint256 s; s < 16; ++s) {
            if (c[s] > 0) ++need;
        }
        for (uint256 i; need > 0 && i < 100_000; ++i) {
            address who = address(uint160(_nextCaster++));
            uint8 s = _refDraw(n, SHA_1104, JOB_1104, _id(n, who), c);
            if (ids[s] != 0) continue;
            ids[s] = _cast(who);
            --need;
        }
        require(need == 0, "not every spot drawn");
    }

    /// a valid step count for `turns` when the test does not care about reach: 0 when he slept, else min(turns, 10)
    function _stepsFor(uint32 turns) internal pure returns (uint8) {
        return turns < 10 ? uint8(turns) : 10;
    }

    function _post(uint32 n, uint16[16] memory c, uint32 turns) internal {
        _postK(n, c, turns, _stepsFor(turns));
    }

    /// the first shot when the test does not name one: the spot with the most landings (the lower one on a tie), the
    /// likeliest first shot; 0 when he slept
    function _firstOf(uint16[16] memory c) internal pure returns (uint8 f) {
        for (uint8 s = 1; s < 16; ++s) {
            if (c[s] > c[f]) f = s;
        }
    }

    function _postK(uint32 n, uint16[16] memory c, uint32 turns, uint8 steps) internal {
        _postF(n, c, turns, steps, _firstOf(c));
    }

    function _postF(uint32 n, uint16[16] memory c, uint32 turns, uint8 steps, uint8 firstShot) internal {
        vm.prank(hatcher);
        qc.postNight(n, c, turns, steps, JOB_1104, SHA_1104, firstShot);
    }

    function _post1104() internal {
        vm.warp(OVER_1104);
        _postF(N1104, _counts1104(), TURNS_1104, STEPS_1104, FIRST_1104);
    }

    function _one(uint8 spot, uint16 hits, uint16 rest) internal pure returns (uint16[16] memory c) {
        c[spot] = hits;
        c[(spot + 1) % 16] = rest;
    }

    // ---- tokenURI attributes, by name (which ones a net has depends on its state) ----

    /// the JSON key of attribute `name`'s value in the metadata JSON j, or "" when the net has no such attribute
    function _attrKey(string memory j, string memory name) internal view returns (string memory) {
        for (uint256 i; i < 20; ++i) {
            string memory key = string.concat(".attributes[", vm.toString(i), "]");
            if (!vm.keyExistsJson(j, key)) return "";
            if (keccak256(bytes(vm.parseJsonString(j, string.concat(key, ".trait_type")))) == keccak256(bytes(name))) {
                return string.concat(key, ".value");
            }
        }
        return "";
    }

    /// the attributes' trait types, in order
    function _traitTypes(string memory j) internal view returns (string memory all) {
        for (uint256 i; i < 20; ++i) {
            string memory key = string.concat(".attributes[", vm.toString(i), "]");
            if (!vm.keyExistsJson(j, key)) break;
            all = string.concat(all, i == 0 ? "" : ",", vm.parseJsonString(j, string.concat(key, ".trait_type")));
        }
    }

    // ---- the owner's rarity rule (5 Nov), written here independently of the contract: a walk and a plain sort ----

    /// a walk of k steps of +1 / -1 from his start (spot turns % 16) ends on start + x, x in {-k, -k + 2, ..., k},
    /// around the ring of 16: in reach iff some such x lands on the spot
    function _walkReach(uint256 spot, uint256 turns, uint256 k) internal pure returns (bool) {
        int256 start = int256(turns % 16);
        for (int256 x = -int256(k); x <= int256(k); x += 2) {
            if (uint256(((start + x) % 16 + 16) % 16) == spot) return true;
        }
        return false;
    }

    /// tier per spot from the catchable spots (`mask`): sorted by landings, most first, equal landings the lower spot
    /// first; with n of them, rank n Epic (Legendary when `first` is on it), n - 1 Rare, n - 3 and n - 2 Uncommon, the
    /// rest Common; every other spot 0
    function _rankTiers(uint16[16] memory c, uint256 mask, uint8 first) internal pure returns (uint8[16] memory t) {
        uint8[16] memory order;
        uint256 n;
        for (uint256 s; s < 16; ++s) {
            if ((mask >> s) & 1 == 1) order[n++] = uint8(s);
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

    /// catchable = in reach (the walk can land there) and at least 1 % of the shots
    function _refMask(uint16[16] memory c, uint256 turns, uint256 steps) internal pure returns (uint256 mask) {
        uint256 shots;
        for (uint256 s; s < 16; ++s) {
            shots += c[s];
        }
        if (shots == 0) return 0;
        for (uint256 s; s < 16; ++s) {
            if (_walkReach(s, turns, steps) && uint256(c[s]) * 100 >= shots) mask |= 1 << s;
        }
    }

    function _refTiers(uint16[16] memory c, uint256 turns, uint256 steps, uint8 first)
        internal
        pure
        returns (uint8[16] memory)
    {
        return _rankTiers(c, _refMask(c, turns, steps), first);
    }
}
