// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {QuantumCatch, IPaintedArt} from "../src/QuantumCatch.sol";

/// Players cast, approve and move nets while time passes; the hatcher tries every call it has, with any arguments.
/// Ghost ownership is updated ONLY by player actions, so the invariant "every net's owner == the ghost owner" proves the
/// hatcher never changed who holds a net (and never held, minted or burned one).
contract Handler is Test {
    QuantumCatch internal qc;
    address internal hatcher;
    address[4] internal players;
    uint256[] public ids;
    mapping(uint256 => address) public ghostOwner;
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

    function cast(uint256 who, uint8 spot) external {
        address p = _player(who);
        vm.prank(p);
        try qc.castNet(uint8(bound(spot, 0, 15))) returns (uint256 id) {
            ids.push(id);
            ghostOwner[id] = p;
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

    function hatcherCast(uint8 spot) external {
        vm.prank(hatcher);
        try qc.castNet(spot) {
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
        qc = new QuantumCatch(hatcher, IPaintedArt(address(0)));
        h = new Handler(qc, hatcher);
        targetContract(address(h));
    }

    function invariant_hatcher_never_changes_ownership() public view {
        uint256 n = h.idsLength();
        uint256 total;
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            assertEq(qc.ownerOf(id), h.ghostOwner(id));
            assertTrue(qc.ownerOf(id) != hatcher);
        }
        for (uint256 i; i < 4; ++i) {
            total += qc.balanceOf(address(uint160(0xA11CE0 + i)));
        }
        assertEq(total, n, "every net is held by a player");
        assertEq(qc.balanceOf(hatcher), 0);
        assertEq(h.hatcherSuccesses(), 0, "no hatcher call ever touched a net");
    }
}
