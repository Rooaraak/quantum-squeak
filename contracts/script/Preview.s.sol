// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {QuantumCatch, IPaintedArt, ISqk} from "../src/QuantumCatch.sol";

/// Local preview, no network: one net in each state (waiting, caught, got away in reach, got away out of reach, he
/// slept, no chip result, and a short night where the ring distance decides reach), each tokenURI printed after a
/// "state: ..." line. Nobody picks a spot: each net's spot is drawn from the night's posted numbers (drawOf), so the
/// preview picks CASTERS whose draw lands where each state needs it. Without the painted art (ART = 0: the small drawn
/// hamster), so the output stays short; the painted NFT is checked end to end by script/anvil-e2e.mjs.
///   forge script script/Preview.s.sol --offline
contract Preview is Script {
    address internal constant HATCHER = address(0x4A7C4E5);
    IPaintedArt internal constant NO_ART = IPaintedArt(address(0));
    uint256 internal _next = 0xA10000;

    function _show(string memory state, QuantumCatch qc, uint256 id) internal view {
        console2.log(string.concat("state: ", state));
        console2.log(qc.tokenURI(id));
    }

    /// cast, for the open night, a net whose shot lands on `spot` once the night is posted with (c, job, sha)
    function _castOn(QuantumCatch qc, uint8 spot, uint16[16] memory c, bytes32 job, bytes32 sha)
        internal
        returns (uint256)
    {
        uint32 n = qc.openNight();
        for (uint256 i; i < 100_000; ++i) {
            address who = address(uint160(_next++));
            if (qc.drawOf(n, sha, job, qc.netId(n, who), c) != spot) continue;
            vm.prank(who);
            return qc.castNet();
        }
        revert("no caster draws that spot");
    }

    function run() external {
        QuantumCatch qc = new QuantumCatch(HATCHER, NO_ART, ISqk(address(0)), 0);
        vm.warp(1793793600 + 3600); // 4 Nov 13:00 UTC
        // 4 Nov, recipe v1 (14 steps, 3817 turns): odd spots in reach
        uint16[16] memory c = [uint16(27), 693, 22, 705, 25, 308, 19, 368, 18, 383, 18, 289, 12, 292, 13, 808];
        bytes32 job = "dbmaa9u74qds73dru4d0";
        bytes32 sha = bytes32(uint256(1));
        uint256 common = _castOn(qc, 15, c, job, sha); // spot 15: 808 / 4000, rank 1 of 8
        uint256 nine = _castOn(qc, 9, c, job, sha); // spot 9: 383 / 4000, rank 4 of 8
        uint256 twelve = _castOn(qc, 12, c, job, sha); // spot 12: 12 / 4000, out of reach
        vm.warp(1793880000 + 60); // the 4 Nov night is over; the 5 Nov nets are open
        vm.prank(address(0xA4));
        uint256 slept = qc.castNet();
        vm.prank(HATCHER);
        qc.postNight(20761, c, 3817, 14, job, sha, 15); // its real first shot: 15
        uint16[16] memory zero;
        vm.warp(1793966400 + 60);
        vm.prank(HATCHER);
        qc.postNight(20762, zero, 0, 0, 0, 0, 0);
        vm.prank(address(0xA1));
        uint256 waiting = qc.castNet();
        _show("waiting", qc, waiting);
        _show("caught-common", qc, common);
        _show("caught-common-spot-9", qc, nine);
        _show("got-away-out-of-reach", qc, twelve);
        _show("slept", qc, slept);
        vm.warp(qc.postDeadline(20763)); // the night of 6 Nov was never posted
        _show("no-chip-result", qc, waiting);

        // out of reach on 31 Oct (v1, 16 steps, 8505 turns): spot 0 got 46 / 4000 (1.15 %) from chip noise alone:
        // got away (the share alone would be Legendary)
        QuantumCatch q2 = new QuantumCatch(HATCHER, NO_ART, ISqk(address(0)), 0);
        vm.warp(1793448000 + 3600);
        uint16[16] memory c31 = [uint16(46), 231, 51, 353, 47, 758, 75, 770, 98, 250, 47, 485, 72, 419, 96, 202];
        c31[1] = 31; // made-up: spot 1 (in reach) at 0.78 % to show a got-away in reach
        c31[5] += 200;
        uint256 out = _castOn(q2, 0, c31, "dbmbiau74qds73ds0hug", bytes32(uint256(2)));
        uint256 low = _castOn(q2, 1, c31, "dbmbiau74qds73ds0hug", bytes32(uint256(2)));
        vm.warp(1793448000 + 86400);
        vm.prank(HATCHER);
        q2.postNight(20757, c31, 8505, 16, "dbmbiau74qds73ds0hug", bytes32(uint256(2)), 13); // its real first shot: 13
        _show("got-away-out-of-reach-31oct", q2, out);
        _show("got-away-in-reach-synthetic", q2, low);
        _shortNight();
    }

    /// made-up short night (he ran 3 rounds): 25 turns, 3 steps, start spot 9. In reach: the even spots at most 3 away
    /// (6, 8, 10, 12). Spot 4 is even but 5 away: out of reach (the parity rule alone called it in reach). Spots 7 and 9
    /// are the bottom of the ring, next to the caption.
    function _shortNight() internal {
        QuantumCatch q3 = new QuantumCatch(HATCHER, NO_ART, ISqk(address(0)), 0);
        vm.warp(1793534400 + 3600); // 1 Nov 13:00 UTC: nets for night 20758
        uint16[16] memory c = [uint16(34), 0, 60, 0, 100, 0, 300, 0, 1700, 46, 1600, 30, 120, 0, 10, 0];
        bytes32 job = "synthetic-short-night";
        bytes32 sha = bytes32(uint256(3));
        uint8[5] memory spots = [uint8(11), 9, 4, 12, 8];
        uint256[5] memory ids;
        for (uint256 i; i < 5; ++i) {
            ids[i] = _castOn(q3, spots[i], c, job, sha);
        }
        vm.warp(1793534400 + 86400);
        vm.prank(HATCHER);
        q3.postNight(20758, c, 25, 3, job, sha, 12); // made up: on the Epic spot
        _show("short-night-out-of-reach-spot-11", q3, ids[0]);
        _show("short-night-out-of-reach-spot-9", q3, ids[1]);
        _show("short-night-out-of-reach-by-distance-spot-4", q3, ids[2]);
        _show("short-night-caught-legendary-spot-12-scarf", q3, ids[3]); // the Epic spot, hit by the first shot
        _show("short-night-caught-uncommon-spot-8", q3, ids[4]);
    }
}
