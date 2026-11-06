// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {QuantumCatch, IPaintedArt} from "../src/QuantumCatch.sol";

/// Local preview, no network: one net in each state (waiting, caught, got away in reach, got away out of reach, he
/// slept, no chip result, and a short night where the ring distance decides reach), each tokenURI printed after a
/// "state: ..." line. Without the painted art (ART = 0: the small drawn hamster), so the output stays short; the
/// painted NFT is checked end to end by script/anvil-e2e.mjs (DeployAll on a local anvil, every state in Chrome).
///   forge script script/Preview.s.sol --offline
contract Preview is Script {
    address internal constant HATCHER = address(0x4A7C4E5);
    IPaintedArt internal constant NO_ART = IPaintedArt(address(0));

    function _show(string memory state, QuantumCatch qc, uint256 id) internal view {
        console2.log(string.concat("state: ", state));
        console2.log(qc.tokenURI(id));
    }

    function run() external {
        QuantumCatch qc = new QuantumCatch(HATCHER, NO_ART);
        vm.warp(1793793600 + 3600); // 4 Nov 13:00 UTC
        address[5] memory p = [address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xA5)];
        uint8[5] memory spots = [uint8(6), 9, 12, 10, 15];
        uint256[5] memory ids;
        for (uint256 i; i < 5; ++i) {
            if (i == 3) continue;
            vm.prank(p[i]);
            ids[i] = qc.castNet(spots[i]);
        }
        vm.warp(1793880000 + 60); // the 4 Nov night is over; the 5 Nov nets are open
        vm.prank(p[3]);
        ids[3] = qc.castNet(spots[3]);
        // 4 Nov, recipe v1 (14 steps, 3817 turns): odd spots in reach
        uint16[16] memory c = [uint16(27), 693, 22, 705, 25, 308, 19, 368, 18, 383, 18, 289, 12, 292, 13, 808];
        vm.prank(HATCHER);
        qc.postNight(20761, c, 3817, 14, "dbmaa9u74qds73dru4d0", bytes32(uint256(1)), 15); // its real first shot: 15
        uint16[16] memory zero;
        vm.warp(1793966400 + 60);
        vm.prank(HATCHER);
        qc.postNight(20762, zero, 0, 0, 0, 0, 0);
        vm.prank(p[0]);
        uint256 waiting = qc.castNet(3);
        _show("waiting", qc, waiting);
        _show("caught-common", qc, ids[4]); // spot 15: 808 / 4000, rank 1 of 8
        _show("caught-common-spot-9", qc, ids[1]); // spot 9: 383 / 4000, rank 4 of 8
        _show("got-away-out-of-reach", qc, ids[2]); // spot 12: 12 / 4000, out of reach
        _show("slept", qc, ids[3]);
        vm.warp(qc.postDeadline(20763)); // the night of 6 Nov was never posted
        _show("no-chip-result", qc, waiting);

        // out of reach on 31 Oct (v1, 16 steps, 8505 turns): spot 0 got 46 / 4000 (1.15 %) from chip noise alone:
        // got away (the share alone would be Legendary)
        QuantumCatch q2 = new QuantumCatch(HATCHER, NO_ART);
        vm.warp(1793448000 + 3600);
        vm.prank(p[0]);
        uint256 out = q2.castNet(0);
        vm.prank(p[1]);
        uint256 low = q2.castNet(1);
        vm.warp(1793448000 + 86400);
        uint16[16] memory c31 = [uint16(46), 231, 51, 353, 47, 758, 75, 770, 98, 250, 47, 485, 72, 419, 96, 202];
        c31[1] = 31; // made-up: spot 1 (in reach) at 0.78 % to show a got-away in reach
        c31[5] += 200;
        vm.prank(HATCHER);
        q2.postNight(20757, c31, 8505, 16, "dbmbiau74qds73ds0hug", bytes32(uint256(2)), 13); // its real first shot: 13
        _show("got-away-out-of-reach-31oct", q2, out);
        _show("got-away-in-reach-synthetic", q2, low);
        _shortNight(p);
    }

    /// made-up short night (he ran 3 rounds): 25 turns, 3 steps, start spot 9. In reach: the even spots at most 3 away
    /// (6, 8, 10, 12). Spot 4 is even but 5 away: out of reach (the parity rule alone called it in reach). Spots 7 and 9
    /// are the bottom of the ring, next to the caption.
    function _shortNight(address[5] memory p) internal {
        QuantumCatch q3 = new QuantumCatch(HATCHER, NO_ART);
        vm.warp(1793534400 + 3600); // 1 Nov 13:00 UTC: nets for night 20758
        uint8[5] memory spots = [uint8(7), 9, 4, 12, 8];
        uint256[5] memory ids;
        for (uint256 i; i < 5; ++i) {
            vm.prank(p[i]);
            ids[i] = q3.castNet(spots[i]);
        }
        vm.warp(1793534400 + 86400);
        uint16[16] memory c = [uint16(34), 0, 60, 0, 100, 0, 300, 0, 1700, 46, 1600, 0, 120, 0, 40, 0];
        vm.prank(HATCHER);
        q3.postNight(20758, c, 25, 3, "synthetic-short-night", bytes32(uint256(3)), 12); // made up: on the Epic spot
        _show("short-night-out-of-reach-spot-7-no-landings", q3, ids[0]);
        _show("short-night-out-of-reach-spot-9", q3, ids[1]);
        _show("short-night-out-of-reach-by-distance-spot-4", q3, ids[2]);
        _show("short-night-caught-legendary-spot-12-scarf", q3, ids[3]); // the Epic spot, hit by the first shot
        _show("short-night-caught-uncommon-spot-8", q3, ids[4]);
    }
}
