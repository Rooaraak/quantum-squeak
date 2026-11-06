// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {QuantumCatch, IPaintedArt, ISqk} from "../src/QuantumCatch.sol";

/// Players cast, approve, move and burn nets while time passes; the hatcher tries every call it has, with any
/// arguments. Ghost ownership is updated ONLY by player actions, so the invariant "every net's owner == the ghost
/// owner" proves the hatcher never changed who holds a net (and never held, minted or burned one); a burned net stays
/// gone and its id is never cast again.
contract Handler is Test {
    QuantumCatch internal qc;
    address internal hatcher;
    address[4] internal players;
    uint256[] public ids;
    mapping(uint256 => address) public ghostOwner; // address(0) once burned
    mapping(uint256 => bool) public burned;
    uint256 public burns;
    uint256 public recasts; // a cast that returned an id seen before (must stay 0)
    uint256 public hatcherSuccesses;
    uint256 public hatcherPosts;

    constructor(QuantumCatch qc_, address hatcher_) {
        qc = qc_;
        hatcher = hatcher_;
        for (uint256 i; i < 4; ++i) {
            players[i] = address(uint160(0xA11CE0 + i));
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _player(uint256 s) internal view returns (address) {
        return players[s % 4];
    }

    function _id(uint256 s) internal view returns (uint256) {
        return ids.length == 0 ? s : ids[s % ids.length];
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 2 days));
    }

    function cast(uint256 who) external {
        address p = _player(who);
        vm.prank(p);
        try qc.castNet() returns (uint256 id) {
            if (burned[id] || ghostOwner[id] != address(0)) ++recasts;
            ids.push(id);
            ghostOwner[id] = p;
        } catch {}
    }

    /// any player burns any net: only its holder or an approved address / operator can
    function burn(uint256 who, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = _id(idSeed);
        vm.prank(_player(who));
        try qc.burn(id) {
            ghostOwner[id] = address(0);
            burned[id] = true;
            ++burns;
        } catch {}
    }

    function transfer(uint256 who, uint256 idSeed, uint256 toSeed) external {
        if (ids.length == 0) return;
        uint256 id = _id(idSeed);
        address from = ghostOwner[id];
        address to = _player(toSeed);
        address caller = _player(who);
        vm.prank(caller);
        try qc.transferFrom(from, to, id) {
            ghostOwner[id] = to;
        } catch {}
    }

    function approve(uint256 who, uint256 idSeed, uint256 toSeed) external {
        if (ids.length == 0) return;
        vm.prank(_player(who));
        try qc.approve(_player(toSeed), _id(idSeed)) {} catch {}
    }

    function approveAll(uint256 who, uint256 toSeed, bool on) external {
        vm.prank(_player(who));
        try qc.setApprovalForAll(_player(toSeed), on) {} catch {}
    }

    // ---- the hatcher, with everything it can call ----
    function hatcherPost(
        uint32 n,
        uint16[16] calldata c,
        uint32 turns,
        uint8 steps,
        bytes32 job,
        bytes32 sha,
        uint8 first
    ) external {
        n = uint32(bound(n, 20755, qc.nightOf(block.timestamp)));
        if (steps > 16) steps = turns == 0 ? 0 : uint8(bound(steps, 1, 16)); // mostly valid, sometimes not
        vm.prank(hatcher);
        try qc.postNight(n, c, turns, steps, job, sha, first) {
            hatcherPosts++;
        } catch {}
    }

    function hatcherCast() external {
        vm.prank(hatcher);
        try qc.castNet() {
            hatcherSuccesses++;
        } catch {}
    }

    function hatcherBurn(uint256 idSeed) external {
        if (ids.length == 0) return;
        vm.prank(hatcher);
        try qc.burn(_id(idSeed)) {
            hatcherSuccesses++;
        } catch {}
    }

    function hatcherTransfer(uint256 idSeed, uint256 toSeed, bool safe) external {
        if (ids.length == 0) return;
        uint256 id = _id(idSeed);
        vm.prank(hatcher);
        if (safe) {
            try qc.safeTransferFrom(ghostOwner[id], _player(toSeed), id) {
                hatcherSuccesses++;
            } catch {}
        } else {
            try qc.transferFrom(ghostOwner[id], hatcher, id) {
                hatcherSuccesses++;
            } catch {}
        }
    }

    function hatcherApprove(uint256 idSeed, uint256 toSeed) external {
        if (ids.length == 0) return;
        vm.prank(hatcher);
        try qc.approve(_player(toSeed), _id(idSeed)) {
            hatcherSuccesses++;
        } catch {}
    }

    function hatcherApproveAll(uint256 toSeed) external {
        vm.prank(hatcher);
        try qc.setApprovalForAll(_player(toSeed), true) {} catch {} // allowed (it owns nothing), proves nothing moves
    }

    function playerToHatcher(uint256 who, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = _id(idSeed);
        vm.prank(_player(who));
        try qc.transferFrom(ghostOwner[id], hatcher, id) {
            hatcherSuccesses++;
        } catch {}
        vm.prank(_player(who));
        try qc.approve(hatcher, id) {
            hatcherSuccesses++;
        } catch {}
        vm.prank(_player(who));
        try qc.setApprovalForAll(hatcher, true) {
            hatcherSuccesses++;
        } catch {}
    }
}

contract CatchInvariantTest is Test {
    QuantumCatch internal qc;
    Handler internal h;
    address internal hatcher = address(0x4A7C4E5);

    function setUp() public {
        vm.warp(1793793600 + 3600);
        qc = new QuantumCatch(hatcher, IPaintedArt(address(0)), ISqk(address(0)), 0);
        h = new Handler(qc, hatcher);
        targetContract(address(h));
    }

    /// how much each run did (forge test -vv): the invariant is only worth something if nets were cast and burned
    function afterInvariant() public view {
        console2.log("nets", h.idsLength(), "burned", h.burns());
    }

    function invariant_hatcher_never_changes_ownership() public view {
        uint256 n = h.idsLength();
        uint256 total;
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            if (h.burned(id)) {
                (bool ok,) = address(qc).staticcall(abi.encodeCall(QuantumCatch.ownerOf, (id)));
                assertFalse(ok, "a burned net stays gone");
                continue;
            }
            assertEq(qc.ownerOf(id), h.ghostOwner(id));
            assertTrue(qc.ownerOf(id) != hatcher);
        }
        for (uint256 i; i < 4; ++i) {
            total += qc.balanceOf(address(uint160(0xA11CE0 + i)));
        }
        assertEq(total, n - h.burns(), "every net not burned is held by a player");
        assertEq(qc.balanceOf(hatcher), 0);
        assertEq(h.hatcherSuccesses(), 0, "no hatcher call ever touched a net");
        assertEq(h.recasts(), 0, "no id is ever cast twice (not even after a burn)");
    }
}
