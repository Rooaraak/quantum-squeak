// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchBase} from "./Base.t.sol";
import {T} from "./URI.t.sol";
import {QuantumCatch, ISqk} from "../src/QuantumCatch.sol";
import {SqkFaucet, IERC20} from "../src/SqkFaucet.sol";
import {MockSqk} from "./mocks/MockSqk.sol";

/// What a holder can see must be true: a net out of reach tonight never catches and says why, a night that never gets
/// a chip result ends, and the description says what the hatcher can and cannot do.
abstract contract HonestyBase is CatchBase {
    string internal constant JSON_PREFIX = "data:application/json;base64,";
    string internal constant SVG_PREFIX = "data:image/svg+xml;base64,";

    function _json(uint256 id) internal view returns (string memory) {
        string memory uri = qc.tokenURI(id);
        return string(T.b64decode(T.after_(uri, bytes(JSON_PREFIX).length)));
    }

    function _svg(string memory j) internal pure returns (string memory) {
        string memory img = vm.parseJsonString(j, ".image");
        return string(T.b64decode(T.after_(img, bytes(SVG_PREFIX).length)));
    }

    /// the JSON key of attribute `name`'s value (the net must have it)
    function _trait(string memory j, string memory name) internal view returns (string memory key) {
        key = _attrKey(j, name);
        assertTrue(bytes(key).length > 0, name);
    }
}

contract OutOfReachTest is HonestyBase {
    string internal constant NOTE_HEAD = "Out of reach tonight: he could not land here; the ";

    function _note(uint256 hits) internal pure returns (string memory) {
        return string.concat(NOTE_HEAD, vm.toString(hits), " landings here are the chip's noise.");
    }

    function test_out_of_reach_never_catches_on_31_oct() public {
        vm.warp(qc.nightStart(N1031) + 3600);
        uint256 out = _castOn(0, _counts1031()); // its shot on 0: 46 / 4000 (1.15 %), out of reach (16 steps, 8505 turns)
        uint256 plain = _castOn(5, _counts1031()); // on 5: 758 / 4000, in reach: Common
        vm.warp(qc.nightOverAt(N1031));
        _postF(N1031, _counts1031(), TURNS_1031, STEPS_1031, FIRST_1031);

        assertGe(uint256(46) * 100, 4000, "1.15 %: catchable, were it in reach");
        (uint8 status,,, uint16 hits, uint32 shots, uint8 tier,) = qc.result(out);
        assertEq(status, 2, "out of reach never catches: got away");
        assertEq(hits, 46, "the landings stay visible");
        assertEq(shots, 4000);
        assertEq(tier, 0);
        assertEq(qc.reachOf(out), 2);
        string memory j = _json(out);
        assertEq(vm.parseJsonString(j, _trait(j, "Status")), "Got away");
        assertEq(vm.parseJsonString(j, _trait(j, "Tier")), "None");
        assertEq(vm.parseJsonUint(j, _trait(j, "Landings")), 46);
        assertEq(vm.parseJsonUint(j, _trait(j, "Steps")), 16);
        assertEq(vm.parseJsonString(j, _trait(j, "Reach")), "Out of reach tonight");
        string memory d = vm.parseJsonString(j, ".description");
        assertTrue(
            T.startsWith(d, string.concat("Sepolia test NFT, no value. Its shot landed on spot 0. ", _note(46), " ")),
            "said plainly"
        );
        assertFalse(T.contains(j, "noise hatch"));
        assertFalse(T.contains(j, "Caught: rank"), "no catch note");
        assertFalse(T.contains(j, "The chip's very first shot of the night landed here."));
        string memory s = _svg(j);
        assertTrue(T.contains(s, "GOT AWAY"));
        assertFalse(T.contains(s, "CAUGHT"));
        assertFalse(T.contains(s, "LEGENDARY"));
        assertFalse(T.contains(s, "NOISE HATCH"), "no noise hatch badge");
        assertTrue(T.contains(s, "id=\"outofreach\""), "the small out of reach mark");
        assertTrue(T.contains(s, "OUT OF REACH"));
        assertTrue(
            T.contains(s, "46 of 4000 shots: chip noise<tspan x=\"160\" dy=\"12\">he could not land here</tspan>")
        );
        assertFalse(T.contains(s, "id=\"hamster\""), "no hamster drawn");

        _checkPlain(plain);
    }

    function _checkPlain(uint256 plain) internal view {
        string memory j = _json(plain);
        assertEq(vm.parseJsonString(j, _trait(j, "Status")), "Caught");
        assertEq(vm.parseJsonString(j, _trait(j, "Tier")), "Common");
        assertEq(vm.parseJsonString(j, _trait(j, "Reach")), "In reach");
        assertFalse(T.contains(vm.parseJsonString(j, ".description"), "Out of reach tonight:"));
        string memory s = _svg(j);
        assertFalse(T.contains(s, "outofreach"));
        assertFalse(T.contains(s, "OUT OF REACH"));
        assertFalse(T.contains(s, "NOISE"));
    }

    /// both v1.2 nights we have, with their real first shots: every net in reach is caught (tier = its rank among the
    /// 8 catchable spots: 4 Common, 2 Uncommon, 1 Rare, 1 Epic), every net out of reach got away with its landings
    /// shown; no Legendary (neither first shot landed on the Epic spot)
    function _everySpot(uint32 n, uint16[16] memory c, uint32 turns, uint8 steps, uint8 first, uint256 reachParity)
        internal
    {
        vm.warp(qc.nightStart(n) + 3600);
        uint256[16] memory ids = _castEvery(c); // one net whose shot lands on each spot
        vm.warp(qc.nightOverAt(n));
        _postF(n, c, turns, steps, first);
        uint8[16] memory want = _refTiers(c, turns, steps, first);
        uint256 caught;
        uint256 outNoise; // out of reach with >= 1 %: a catch under the share rule
        uint256[6] memory per;
        for (uint256 s; s < 16; ++s) {
            bool reach = s % 2 == reachParity;
            assertEq(reach, (s + turns + steps) % 2 == 0);
            if (_checkSpot(ids[s], c[s], reach, want[s])) ++caught;
            else if (uint256(c[s]) * 100 >= 4000) ++outNoise;
            ++per[want[s]];
        }
        assertEq(caught, 8, "every spot in reach was caught on this night");
        assertGe(outNoise, 5, "at least 5 spots out of reach got >= 1 % from chip noise alone");
        assertEq(per[1], 4, "4 Common");
        assertEq(per[2], 2, "2 Uncommon");
        assertEq(per[3], 1, "1 Rare");
        assertEq(per[4], 1, "1 Epic");
        assertEq(per[5], 0, "no Legendary");
    }

    function _checkSpot(uint256 id, uint16 count, bool reach, uint8 want) internal view returns (bool caught) {
        (uint8 status,,, uint16 hits,, uint8 tier,) = qc.result(id);
        assertEq(hits, count, "the landings stay visible");
        assertGt(hits, 0, "a drawn shot's spot has a landing: the shot itself");
        assertEq(qc.reachOf(id), reach ? 1 : 2);
        assertTrue(tier != 5, "no Legendary");
        string memory j = _json(id);
        assertFalse(T.contains(j, "noise hatch"));
        assertFalse(T.contains(_svg(j), "NOISE HATCH"));
        string memory d = vm.parseJsonString(j, ".description");
        assertEq(tier, want);
        if (reach) {
            assertFalse(T.contains(d, "Out of reach tonight:"));
        } else {
            assertEq(status, 2);
            assertEq(tier, 0);
            assertEq(vm.parseJsonString(j, _trait(j, "Reach")), "Out of reach tonight");
            assertTrue(T.contains(d, _note(count)));
        }
        return status == 1;
    }

    /// spots 0, 2, 4, 8, 14: >= 1 % out of reach (caught before the reach rule), now got away
    function test_every_spot_of_the_v12_night_of_4_nov() public {
        _everySpot(N1104, _counts1104v12(), TURNS_1104, STEPS_1104_V12, FIRST_1104_V12, 1);
    }

    /// spots 3, 5, 7, 11, 13, 15: >= 1 % out of reach (caught before the reach rule), now got away
    function test_every_spot_of_the_v12_rerun_of_1_nov() public {
        _everySpot(N1101, _counts1101v12(), TURNS_1101, STEPS_1101_V12, FIRST_1101_V12, 0);
    }

    function test_out_of_reach_even_with_most_of_the_shots() public {
        // the hatcher's numbers are not checked: even 3999 of 4000 landings on a spot out of reach do not catch
        uint256 id = _castOn(2, _one(2, 3999, 1));
        vm.warp(OVER_1104);
        _postF(N1104, _one(2, 3999, 1), 1, 1, 3); // 2 + 1 + 1 even: in reach; the only catchable spot: Epic
        (uint8 status,,,,, uint8 tier,) = qc.result(id);
        assertEq(status, 1);
        assertEq(tier, 4);

        vm.warp(qc.nightStart(N1104 + 1) + 60);
        uint256 out = _castOn(2, _one(2, 3999, 1));
        vm.warp(qc.nightOverAt(N1104 + 1));
        _postK(N1104 + 1, _one(2, 3999, 1), 2, 1); // 2 + 2 + 1 odd: out of reach
        (uint8 st2,,, uint16 hits,, uint8 t2,) = qc.result(out);
        assertEq(st2, 2);
        assertEq(t2, 0);
        assertEq(hits, 3999);
        assertTrue(T.contains(vm.parseJsonString(_json(out), ".description"), _note(3999)));
    }

    /// the 1 landing out of reach is the drawn shot itself; a spot without landings is never drawn (DrawTest)
    function test_out_of_reach_words_for_one_landing() public {
        uint16[16] memory c;
        c[2] = 1;
        c[3] = 3999;
        vm.warp(qc.nightStart(N1104) + 60);
        uint256 one = _castOn(2, c);
        vm.warp(OVER_1104);
        _postK(N1104, c, 2, 1); // even spots out of reach
        string memory d = vm.parseJsonString(_json(one), ".description");
        assertTrue(
            T.contains(d, "Out of reach tonight: he could not land here; the 1 landing here is the chip's noise."), d
        );
        assertFalse(T.contains(d, "did not land here"), "a drawn spot always has its shot");
        (uint8 status,,, uint16 hits,, uint8 tier,) = qc.result(one);
        assertEq(status, 2);
        assertEq(hits, 1);
        assertEq(tier, 0);
    }

    function test_in_reach_got_away_has_no_out_of_reach_words() public {
        uint256 id = _castOn(10, _one(10, 39, 3961));
        vm.warp(OVER_1104);
        _postK(N1104, _one(10, 39, 3961), 9, 1); // 10 + 9 + 1 even, 1 spot from his start (9): in reach, under 1 %
        (uint8 status,,,,, uint8 tier,) = qc.result(id);
        assertEq(status, 2);
        assertEq(tier, 0);
        assertEq(qc.reachOf(id), 1);
        string memory j = _json(id);
        assertFalse(T.contains(vm.parseJsonString(j, ".description"), "Out of reach tonight:"));
        assertTrue(
            T.contains(vm.parseJsonString(j, ".description"), "Under 1% of the shots landed here: the hamster got away.")
        );
        string memory s = _svg(j);
        assertTrue(T.contains(s, "GOT AWAY"));
        assertTrue(T.contains(s, "39 of 4000 shots on spot 10"));
        assertFalse(T.contains(s, "outofreach"));
    }
}

contract NoChipResultTest is HonestyBase {
    function test_a_ran_night_without_a_chip_result_ends_as_no_chip_result() public {
        uint256 id = _cast(alice);
        vm.warp(OVER_1104 + 14 days - 1);
        (uint8 status,,,,,,) = qc.result(id);
        assertEq(status, 0, "still waiting inside the 14-day window");
        vm.warp(OVER_1104 + 14 days);
        (status,,,,,,) = qc.result(id);
        assertEq(status, 4, "no chip result: final");
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, _trait(j, "Status")), "No chip result");
        assertEq(qc.spotOf(id), 255, "nothing drawn, for good");
        assertTrue(T.contains(_svg(j), "NO CHIP RESULT"));
        vm.warp(OVER_1104 + 3650 days);
        (status,,,,,,) = qc.result(id);
        assertEq(status, 4, "ten years later: not waiting forever");
    }

    function test_no_post_once_the_window_has_closed() public {
        uint256 id = _cast(alice);
        vm.warp(OVER_1104 + 14 days);
        vm.expectRevert();
        _postK(N1104, _counts1104(), TURNS_1104, 14);
        (uint8 status,,,,,,) = qc.result(id);
        assertEq(status, 4);
    }

    function test_post_one_second_before_the_window_closes() public {
        uint256 id = _castOn(15, _counts1104());
        vm.warp(OVER_1104 + 14 days - 1);
        _postK(N1104, _counts1104(), TURNS_1104, 14);
        (uint8 status,,,,,,) = qc.result(id);
        assertEq(status, 1);
        vm.warp(OVER_1104 + 3650 days);
        (status,,,,,,) = qc.result(id);
        assertEq(status, 1, "a posted result stays");
    }
}

contract DescriptionTest is HonestyBase {
    function test_description_says_what_the_hatcher_can_and_cannot_do() public {
        string memory d = vm.parseJsonString(_json(_cast(alice)), ".description");
        assertTrue(T.startsWith(d, "Sepolia test NFT, no value."));
        assertFalse(T.contains(d, "Free"), "a v2 net may have cost test SQK");
        assertTrue(T.contains(d, "it is not a player"));
        assertTrue(T.contains(d, "by the hatcher"), "who reads SqueekCore");
        assertFalse(T.contains(d, "read from SqueekCore on-chain"));
        assertTrue(T.contains(d, "only power is to post"));
        assertTrue(T.contains(d, "once"));
        assertTrue(T.contains(d, "cannot mint, move or burn"));
        assertTrue(T.contains(d, "cannot check"));
        assertTrue(T.contains(d, "14 days"));
        assertTrue(T.contains(d, "No chip result"));
        assertTrue(T.contains(d, "The tier is the spot's rank among tonight's catchable spots by landings"));
        assertTrue(T.contains(d, "the last one is Epic, the one before it Rare, the two before those Uncommon"));
        assertTrue(T.contains(d, "Legendary is the Epic spot when the chip's very first shot of the night landed on it"));
        assertTrue(T.contains(d, "the first shot is the first entry of its shots_in_order plus his total turns, mod 16"));
        assertFalse(T.contains(d, "landing share"));
        assertFalse(T.contains(d, "Caught: rank"), "no catch note on a waiting net");
        assertTrue(T.contains(d, "can only land on spots of the right parity within k spots of his start"));
        assertFalse(T.contains(d, "every other spot"), "not true of a short walk");
        assertTrue(T.contains(d, "A shot on a spot out of reach tonight never catches"), "the reach rule");
        assertFalse(T.contains(d, "noise hatch"));
        assertFalse(T.contains(d, "Out of reach tonight:"), "no per-net note on a waiting net");
        assertFalse(T.contains(d, "Its shot landed"), "nothing drawn on a waiting net");
    }

    /// no picking (6 Nov): the description says how the spot is drawn, from what, that no caster can choose it, and that
    /// the hatcher (which learns the draws first: it posts the sha256 and the job id) is trusted for them
    function test_description_says_how_the_spot_is_drawn() public {
        string memory d = vm.parseJsonString(_json(_cast(alice)), ".description");
        assertTrue(T.contains(d, "a ticket for one of the chip's shots, nobody picks a spot"));
        assertTrue(T.contains(d, "drawn at random over all its landings"));
        assertTrue(
            T.contains(d, "keccak256 of the night, the result file's sha256, the IBM job id and the net's token id")
        );
        assertTrue(T.contains(d, "so a spot with more landings is drawn more often"));
        assertTrue(
            T.contains(
                d,
                "the nets close before the chip runs, so no caster can know or choose a draw; the hatcher, which posts "
                "the result, sees the draws first and is trusted for them as for every number"
            )
        );
        assertFalse(T.contains(d, "nobody can know or choose a draw"), "the hatcher knows the draws before it posts");
        assertTrue(T.contains(d, "A night he slept draws nothing."));
        assertTrue(T.contains(d, "Only a net's holder, or an address it approves, can burn it."));
        assertFalse(T.contains(d, "A net on one spot"), "the old pick-a-spot words are gone");
        assertFalse(T.contains(d, "a net on a catchable spot"));
    }

    function test_result_sha256_is_in_the_metadata() public {
        uint256 id = _cast(alice);
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, _trait(j, "Result sha256")), "none");
        _post1104();
        j = _json(id);
        assertEq(vm.parseJsonString(j, _trait(j, "Result sha256")), vm.toString(SHA_1104));
    }
}

contract StepsAndWindowTest is HonestyBase {
    function test_steps_must_fit_the_night() public {
        vm.warp(OVER_1104);
        uint16[16] memory zero;
        uint16[16] memory c = _counts1104();
        vm.startPrank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadSteps.selector, uint32(0), uint8(1)));
        qc.postNight(N1104, zero, 0, 1, 0, 0, 0); // he slept: no steps
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadSteps.selector, uint32(5), uint8(0)));
        qc.postNight(N1104, c, 5, 0, JOB_1104, SHA_1104, 1); // he ran: at least one step
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadSteps.selector, uint32(5), uint8(6)));
        qc.postNight(N1104, c, 5, 6, JOB_1104, SHA_1104, 1); // a step is at least one turn
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadSteps.selector, TURNS_1104, uint8(17)));
        qc.postNight(N1104, c, TURNS_1104, 17, JOB_1104, SHA_1104, 1); // no recipe uses more than 16
        qc.postNight(N1104, c, 16, 16, JOB_1104, SHA_1104, 1);
        vm.stopPrank();
        (,,,,, uint8 steps,,,) = qc.nightRecord(N1104);
        assertEq(steps, 16);
    }

    function test_post_window_boundaries() public {
        assertEq(qc.POST_WINDOW(), 14 days);
        assertEq(qc.postDeadline(N1104), OVER_1104 + 14 days);
        vm.warp(OVER_1104 + 14 days);
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.PostWindowClosed.selector, N1104, OVER_1104 + 14 days));
        qc.postNight(N1104, _counts1104(), TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, FIRST_1104);
        uint16[16] memory zero;
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.PostWindowClosed.selector, N1104, OVER_1104 + 14 days));
        qc.postNight(N1104, zero, 0, 0, 0, 0, 0); // not even "he slept"
    }

    function test_reachOf_in_every_state() public {
        uint256 a = _castOn(1, _counts1104v12()); // its shot in reach on 4 Nov v1.2 (1 + 3817 + 10 even)
        uint256 b = _castOn(0, _counts1104v12()); // out of reach
        assertEq(qc.reachOf(a), 0, "waiting");
        vm.warp(OVER_1104);
        _postK(N1104, _counts1104v12(), TURNS_1104, STEPS_1104_V12);
        assertEq(qc.reachOf(a), 1);
        assertEq(qc.reachOf(b), 2);
        string memory j = _json(a);
        assertEq(vm.parseJsonUint(j, _trait(j, "Steps")), 10);

        vm.warp(qc.nightStart(N1104 + 1) + 60);
        uint256 slept = _cast(alice);
        uint256 none = _cast(bob);
        vm.warp(qc.nightOverAt(N1104 + 1));
        uint16[16] memory zero;
        _postK(N1104 + 1, zero, 0, 0);
        assertEq(qc.reachOf(slept), 0, "he slept");
        j = _json(slept);
        assertEq(vm.parseJsonString(j, _trait(j, "Reach")), "No run");
        assertEq(vm.parseJsonString(j, _trait(j, "Result sha256")), vm.toString(SHA_1104));

        vm.warp(qc.nightStart(N1104 + 2) + 60);
        uint256 lost = _cast(alice);
        vm.warp(qc.postDeadline(N1104 + 2));
        assertEq(qc.reachOf(lost), 0, "no chip result");
        j = _json(lost);
        assertEq(vm.parseJsonString(j, _trait(j, "Reach")), "Not known");
        assertEq(vm.parseJsonUint(j, _trait(j, "Steps")), 0);
        none; // bob's net of the slept night: same as alice's
        assertEq(qc.reachOf(none), 0);
    }

    function test_hatcher_numbers_are_not_checked_beyond_consistency() public {
        // the contract cannot tell a real chip run from made-up numbers: one landing, any job id, is accepted.
        // The description says so (DescriptionTest); holders check the result file by its sha256.
        uint256 id = _cast(alice);
        vm.warp(OVER_1104);
        uint16[16] memory c;
        c[7] = 1; // the only landing: every net's shot
        vm.prank(hatcher);
        qc.postNight(N1104, c, 6, 1, "anything", bytes32(0), 7); // 7 + 6 + 1 even, 1 spot from his start (6): in reach
        (uint8 status,,,, uint32 shots, uint8 tier,) = qc.result(id);
        assertEq(status, 1);
        assertEq(shots, 1);
        assertEq(tier, 5, "the one catchable spot, hit by the (only) first shot: Legendary");
    }
}

/// v2 (paid nets) and the faucet: still nothing to administer. No owner, no withdraw, no setter, no pause, no upgrade,
/// nothing payable; the game never keeps the SQK it is paid (it burns it in the same call) and can only ever take
/// NET_COST from a wallet casting its own net; the faucet's SQK can only leave as one DRIP per address.
contract NoAdminTest is HonestyBase {
    uint256 internal constant COST = 1e16;
    uint256 internal constant DRIP = 1e16; // one net's worth per wallet per net night (amendment 1)

    MockSqk internal sqk;
    SqkFaucet internal faucet;

    function setUp() public override {
        super.setUp();
        sqk = new MockSqk();
        qc = new QuantumCatch(hatcher, NO_ART, ISqk(address(sqk)), COST);
        faucet = new SqkFaucet(IERC20(address(sqk)), DRIP, address(qc));
        sqk.mint(address(faucet), 10 * DRIP);
    }

    /// admin-shaped functions found in other contracts; none exists here (each call reverts: no fallback either)
    function _adminSigs() internal pure returns (string[25] memory) {
        return [
            "owner()",
            "admin()",
            "getOwner()",
            "transferOwnership(address)",
            "renounceOwnership()",
            "acceptOwnership()",
            "withdraw()",
            "withdraw(uint256)",
            "withdraw(address)",
            "withdraw(address,uint256)",
            "withdrawToken(address,uint256)",
            "sweep(address)",
            "rescue(address,uint256)",
            "recover(address,uint256)",
            "pause()",
            "unpause()",
            "setDrip(uint256)",
            "setNetCost(uint256)",
            "setSqk(address)",
            "setToken(address)",
            "setHatcher(address)",
            "setCatch(address)",
            "upgradeTo(address)",
            "upgradeToAndCall(address,bytes)",
            "selfDestruct()"
        ];
    }

    function _noneAnswers(address target) internal {
        string[25] memory sigs = _adminSigs();
        for (uint256 i; i < sigs.length; ++i) {
            (bool ok,) = target.call(abi.encodePacked(bytes4(keccak256(bytes(sigs[i]))), new bytes(128)));
            assertFalse(ok, sigs[i]);
        }
        vm.deal(address(this), 1 ether);
        (bool paid,) = target.call{value: 1}("");
        assertFalse(paid, "no receive / fallback: nothing payable");
    }

    function test_the_paid_game_has_no_admin() public {
        _noneAnswers(address(qc));
        // and it cannot move SQK of its own accord: no ERC-20 transfer / transferFrom of its own
        (bool ok,) = address(qc).call(abi.encodeWithSignature("transfer(address,uint256)", alice, 1));
        assertFalse(ok);
        (ok,) = address(qc).call(abi.encodeWithSignature("burnFrom(address,uint256)", alice, 1));
        assertFalse(ok);
    }

    function test_the_faucet_has_no_admin() public {
        _noneAnswers(address(faucet));
        string[5] memory moves = [
            "transfer(address,uint256)",
            "transferFrom(address,address,uint256)",
            "approve(address,uint256)",
            "claimFor(address)",
            "drain()"
        ];
        for (uint256 i; i < moves.length; ++i) {
            (bool ok,) = address(faucet).call(abi.encodePacked(bytes4(keccak256(bytes(moves[i]))), new bytes(96)));
            assertFalse(ok, moves[i]);
        }
        assertEq(faucet.remaining(), 10 * DRIP, "nothing left the faucet");
    }

    function test_the_game_keeps_no_sqk_and_takes_only_the_cost_of_your_own_net() public {
        sqk.mint(alice, 1e18);
        sqk.mint(bob, 1e18);
        vm.prank(alice);
        sqk.approve(address(qc), type(uint256).max); // even an unlimited allowance
        vm.prank(bob);
        sqk.approve(address(qc), type(uint256).max);
        uint256 supply = sqk.totalSupply();
        for (uint32 d; d < 5; ++d) {
            vm.warp(qc.nightStart(N1104 + d) + 60);
            _cast(alice);
            if (d % 2 == 0) _cast(bob);
            assertEq(sqk.balanceOf(address(qc)), 0, "burned in the same call, every time");
        }
        assertEq(sqk.balanceOf(alice), 1e18 - 5 * COST, "5 nets, 5 x the cost, not a wei more");
        assertEq(sqk.balanceOf(bob), 1e18 - 3 * COST);
        assertEq(sqk.totalSupply(), supply - 8 * COST, "all of it burned");
        // the hatcher's only power is postNight: it cannot spend anyone's allowance either
        vm.warp(qc.nightOverAt(N1104));
        _post(N1104, _counts1104(), TURNS_1104);
        assertEq(sqk.balanceOf(alice), 1e18 - 5 * COST);
    }

    function test_the_faucet_hands_out_one_drip_per_address_per_night_and_nothing_else() public {
        uint256 before = sqk.totalSupply();
        for (uint256 i; i < 10; ++i) {
            address p = makeAddr(string.concat("claimer", vm.toString(i % 5)));
            if (i == 5) vm.warp(LOCK_1104); // 21:00 UTC: the next net night, the same 5 wallets again
            uint32 n = qc.openNight();
            vm.prank(p);
            faucet.claim();
            assertEq(sqk.balanceOf(p), DRIP * (i / 5 + 1));
            vm.prank(p);
            vm.expectRevert(abi.encodeWithSelector(SqkFaucet.AlreadyClaimedTonight.selector, n));
            faucet.claim();
        }
        assertEq(faucet.remaining(), 0);
        assertEq(sqk.totalSupply(), before, "a faucet moves, it does not mint");
    }
}
