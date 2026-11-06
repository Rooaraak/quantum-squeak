// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchBase} from "./Base.t.sol";
import {T} from "./URI.t.sol";
import {QuantumCatch} from "../src/QuantumCatch.sol";

/// traitsOf as one struct (its 9 return values in one memory struct: no stack juggling in the tests)
abstract contract TraitsRead is CatchBase {
    struct Traits {
        uint32 night;
        bool posted;
        bool caught;
        uint8 spot;
        bool hat;
        bool glasses;
        bool scarf;
        bool grin;
        uint8 tier;
    }

    function _traits(uint256 t) internal view returns (Traits memory r) {
        (bool ok, bytes memory ret) = address(qc).staticcall(abi.encodeCall(QuantumCatch.traitsOf, (t)));
        require(ok, "traitsOf reverted");
        r = abi.decode(ret, (Traits));
    }
}

/// No picking (the owner's rule, 6 Nov): a net is a ticket; once the night is posted it gets one of the chip's shots,
/// drawn over ALL the night's landings, x = keccak256(abi.encode(night, sha, jobId, tokenId)) % shots, then spot by
/// spot. Its tier is the drawn spot's (the rarity rule); a shot on a spot that is not catchable got away.
contract DrawTest is TraitsRead {
    /// 4 Nov v1 (14 steps, start 9): the odd spots in reach and catchable; the even ones are chip noise (154 of 4000)
    function _evenNoise() internal pure returns (uint256 noise) {
        uint16[16] memory c = _counts1104();
        for (uint256 s; s < 16; s += 2) {
            noise += c[s];
        }
    }

    function test_the_draw_is_deterministic_and_is_the_reference() public view {
        uint16[16] memory c = _counts1104();
        for (uint256 i; i < 300; ++i) {
            uint256 id = _id(N1104, address(uint160(0xD0000 + i)));
            uint8 a = qc.drawOf(N1104, SHA_1104, JOB_1104, id, c);
            assertEq(a, qc.drawOf(N1104, SHA_1104, JOB_1104, id, c), "same inputs, same spot");
            assertEq(a, _refDraw(N1104, SHA_1104, JOB_1104, id, c), "the test's own running-sum draw");
            assertGt(c[a], 0, "only a spot that has landings is ever drawn");
        }
    }

    /// what a holder reads (result / spotOf / traitsOf) is drawOf over the posted record, nothing else
    function test_result_is_drawOf_of_the_posted_record() public {
        uint256[24] memory ids;
        for (uint256 i; i < 24; ++i) {
            ids[i] = _cast(address(uint160(0xD1000 + i)));
        }
        _post1104();
        (,,,,,, bytes32 job, bytes32 sha,) = qc.nightRecord(N1104);
        assertEq(job, JOB_1104);
        assertEq(sha, SHA_1104);
        for (uint256 i; i < 24; ++i) {
            uint8 want = qc.drawOf(N1104, sha, job, ids[i], _counts1104());
            (,, uint8 spot,,,,) = qc.result(ids[i]);
            assertEq(spot, want);
            assertEq(qc.spotOf(ids[i]), want);
            assertEq(_traits(ids[i]).spot, want);
        }
    }

    /// every key changes the draw: another night, sha256, job id or token id draws another spot most of the time
    /// (two draws of the 4 Nov night agree with chance sum p^2 = 13.5 %)
    function test_every_key_of_the_draw_matters() public view {
        uint16[16] memory c = _counts1104();
        uint256[4] memory differ;
        for (uint256 i; i < 300; ++i) {
            uint256 id = _id(N1104, address(uint160(0xD2000 + i)));
            uint8 a = qc.drawOf(N1104, SHA_1104, JOB_1104, id, c);
            if (qc.drawOf(N1104 + 1, SHA_1104, JOB_1104, id, c) != a) ++differ[0];
            if (qc.drawOf(N1104, keccak256("another file"), JOB_1104, id, c) != a) ++differ[1];
            if (qc.drawOf(N1104, SHA_1104, "anotherjob", id, c) != a) ++differ[2];
            if (qc.drawOf(N1104, SHA_1104, JOB_1104, id + 1, c) != a) ++differ[3];
        }
        for (uint256 k; k < 4; ++k) {
            assertGt(differ[k], 200, vm.toString(k));
        }
    }

    function testFuzz_the_draw_lands_only_where_the_chip_landed(uint16[16] memory c, bytes32 sha, uint256 id)
        public
        view
    {
        for (uint256 s; s < 16; ++s) {
            if (uint256(c[s]) % 3 == 0) c[s] = 0; // empty spots, often
        }
        uint256 shots;
        for (uint256 s; s < 16; ++s) {
            shots += c[s];
        }
        uint8 d = qc.drawOf(N1104, sha, JOB_1104, id, c);
        assertEq(d, _refDraw(N1104, sha, JOB_1104, id, c));
        if (shots == 0) assertEq(d, qc.NO_SPOT(), "nothing landed: nothing drawn");
        else assertGt(c[d], 0);
    }

    /// |seen - expected| within 5 standard deviations (+ 2 for the smallest counts), per spot
    function _assertProportional(uint256[16] memory seen, uint16[16] memory c, uint256 draws, uint256 sigmas)
        internal
        pure
    {
        uint256 shots;
        for (uint256 s; s < 16; ++s) {
            shots += c[s];
        }
        for (uint256 s; s < 16; ++s) {
            uint256 e = draws * c[s] / shots; // expected
            uint256 var_ = draws * c[s] * (shots - c[s]) / (shots * shots); // n p (1 - p)
            uint256 tol = sigmas * _sqrt(var_) + 2;
            uint256 d = seen[s] > e ? seen[s] - e : e - seen[s];
            assertLe(d, tol, string.concat("spot ", vm.toString(s), " seen ", vm.toString(seen[s]), " expected ", vm.toString(e)));
            if (c[s] == 0) assertEq(seen[s], 0);
        }
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            (y, z) = (z, (x / z + z) / 2);
        }
    }

    /// 16,000 draws of the real 4 Nov night: each spot is drawn in proportion to its landings, and the share of draws
    /// that got away (the even spots, out of reach that night: chip noise) is the chip's noise share, 154 of 4000
    function test_frequencies_follow_the_landings_on_the_4_nov_night() public view {
        uint16[16] memory c = _counts1104();
        uint256 draws = 16_000;
        uint256[16] memory seen;
        for (uint256 i; i < draws; ++i) {
            ++seen[qc.drawOf(N1104, SHA_1104, JOB_1104, _id(N1104, address(uint160(0xF0000 + i))), c)];
        }
        _assertProportional(seen, c, draws, 5);
        uint256 away;
        for (uint256 s; s < 16; s += 2) {
            away += seen[s];
        }
        uint256 e = draws * _evenNoise() / 4000; // 616 (3.85 %)
        assertEq(_evenNoise(), 154);
        assertApproxEqAbs(away, e, 5 * _sqrt(e) + 2, "got away as often as the chip's noise lands");
    }

    /// any night's numbers, any posted sha256: the frequencies follow the landings (a few hundred landings on a few
    /// spots, many spots empty)
    /// forge-config: default.fuzz.runs = 12
    function testFuzz_frequencies_follow_the_landings(uint16[16] memory c, bytes32 sha) public view {
        uint256 shots;
        for (uint256 s; s < 16; ++s) {
            c[s] = uint256(c[s]) % 4 == 0 ? uint16(uint256(c[s]) % 700) : 0;
            shots += c[s];
        }
        if (shots == 0) c[uint256(sha) % 16] = 1;
        uint256 draws = 3000;
        uint256[16] memory seen;
        for (uint256 i; i < draws; ++i) {
            ++seen[qc.drawOf(N1104, sha, JOB_1104, uint256(keccak256(abi.encode(i))), c)];
        }
        _assertProportional(seen, c, draws, 6);
    }

    /// 64 nets on the 4 Nov night: a net is caught exactly when its shot landed on a catchable spot, with that spot's
    /// tier; a shot on a spot out of reach got away (its landings are chip noise)
    function test_caught_iff_the_shot_landed_on_a_catchable_spot() public {
        uint256[64] memory ids;
        for (uint256 i; i < 64; ++i) {
            ids[i] = _cast(address(uint160(0xD3000 + i)));
        }
        _post1104();
        uint16[16] memory c = _counts1104();
        uint256 mask = _refMask(c, TURNS_1104, STEPS_1104);
        uint8[16] memory tiers = _refTiers(c, TURNS_1104, STEPS_1104, FIRST_1104);
        uint256 caught;
        for (uint256 i; i < 64; ++i) {
            uint8 s = _refDraw(N1104, SHA_1104, JOB_1104, ids[i], c);
            (uint8 status,, uint8 spot, uint16 hits,, uint8 tier,) = qc.result(ids[i]);
            assertEq(spot, s);
            assertEq(hits, c[s]);
            assertEq(tier, tiers[s]);
            bool catchable = (mask >> s) & 1 == 1;
            assertEq(status, catchable ? 1 : 2);
            assertEq(qc.reachOf(ids[i]), _walkReach(s, TURNS_1104, STEPS_1104) ? 1 : 2);
            if (catchable) ++caught;
        }
        assertGt(caught, 50, "most shots land on a catchable spot on a healthy night");
    }

    /// a spot in reach but under 1 %: a shot drawn there got away (in reach); out of reach with most of the shots:
    /// still got away (the hatcher's numbers are not checked, the reach rule holds)
    function test_got_away_in_reach_under_1_percent_and_out_of_reach() public {
        uint16[16] memory c = _one(10, 39, 3961); // spot 10: 39 of 4000, in reach (9 turns, 1 step: spots 8, 10)
        uint256 low = _castOn(10, c);
        uint256 top = _castOn(11, c); // spot 11: 3961 landings, out of reach (odd)
        vm.warp(OVER_1104);
        _postK(N1104, c, 9, 1);
        (uint8 st,, uint8 spot, uint16 hits,, uint8 tier,) = qc.result(low);
        assertEq(st, 2);
        assertEq(spot, 10);
        assertEq(hits, 39);
        assertEq(tier, 0);
        assertEq(qc.reachOf(low), 1);
        (st,, spot, hits,, tier,) = qc.result(top);
        assertEq(st, 2, "out of reach never catches, even with 99 % of the shots");
        assertEq(spot, 11);
        assertEq(hits, 3961);
        assertEq(qc.reachOf(top), 2);
    }

    /// Legendary = the Epic spot AND the chip's first shot landed there; the first shot elsewhere: Epic stays Epic,
    /// and the spot it landed on keeps its own tier
    function test_legendary_only_on_the_epic_spot_with_the_first_shot() public {
        uint16[16] memory c = _counts1104v12(); // Epic = spot 7 (254), Uncommon spot 3
        uint256 epic = _castOn(7, c);
        uint256 three = _castOn(3, c);
        vm.warp(OVER_1104);
        _postF(N1104, c, TURNS_1104, STEPS_1104_V12, 7); // first shot on the Epic spot
        (,,,,, uint8 t,) = qc.result(epic);
        assertEq(t, 5, "Legendary");
        (,,,,, t,) = qc.result(three);
        assertEq(t, 2);

        uint32 n = N1104 + 1;
        vm.warp(qc.nightStart(n) + 60);
        epic = _castOn(7, c);
        three = _castOn(3, c);
        vm.warp(qc.nightOverAt(n));
        _postF(n, c, TURNS_1104, STEPS_1104_V12, 3); // the real first shot: spot 3 (Uncommon)
        (,,,,, t,) = qc.result(epic);
        assertEq(t, 4, "Epic: the first shot was elsewhere");
        (,,,,, t,) = qc.result(three);
        assertEq(t, 2, "the first shot on an Uncommon spot: still Uncommon");
        assertEq(_traits(epic).spot, 7);
        assertEq(_traits(epic).tier, 4);
    }

    function test_a_slept_night_draws_nothing() public {
        uint256 id = _cast(alice);
        vm.warp(OVER_1104);
        uint16[16] memory zero;
        _postK(N1104, zero, 0, 0);
        (uint8 status,, uint8 spot,,, uint8 tier, uint8 looks) = qc.result(id);
        assertEq(status, 3);
        assertEq(spot, 255);
        assertEq(tier, 0);
        assertEq(looks, 0);
        assertEq(qc.spotOf(id), 255);
        assertEq(qc.drawOf(N1104, SHA_1104, JOB_1104, id, zero), 255);
    }

    /// the draw keys come from the posted record: the same nets on the same counts draw differently under another
    /// sha256 and job id, and each one follows the record that was posted
    function test_the_draw_follows_the_posted_sha_and_job() public {
        uint16[16] memory c = _counts1104();
        uint256[40] memory ids;
        for (uint256 i; i < 40; ++i) {
            ids[i] = _cast(address(uint160(0xD4000 + i)));
        }
        vm.warp(OVER_1104);
        bytes32 sha = keccak256("the real file");
        vm.prank(hatcher);
        qc.postNight(N1104, c, TURNS_1104, STEPS_1104, "otherjob", sha, FIRST_1104);
        uint256 moved;
        for (uint256 i; i < 40; ++i) {
            uint8 got = qc.spotOf(ids[i]);
            assertEq(got, _refDraw(N1104, sha, "otherjob", ids[i], c));
            if (got != _refDraw(N1104, SHA_1104, JOB_1104, ids[i], c)) ++moved;
        }
        assertGt(moved, 20);
    }
}

/// burn(tokenId): the holder, or an address approved for the net or for all the holder's nets; nobody else, never the
/// hatcher. A burned net is gone for good and its id can never be cast again.
contract BurnTest is CatchBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _cast(alice);
    }

    function _gone(uint256 t) internal {
        bytes memory e = abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, t);
        vm.expectRevert(e);
        qc.ownerOf(t);
        vm.expectRevert(e);
        qc.tokenURI(t);
        vm.expectRevert(e);
        qc.result(t);
        vm.expectRevert(e);
        qc.traitsOf(t);
        vm.expectRevert(e);
        qc.spotOf(t);
        vm.expectRevert(e);
        qc.getApproved(t);
        vm.expectRevert(e);
        qc.reachOf(t);
    }

    function test_burn_by_the_holder() public {
        vm.expectEmit(true, true, true, true, address(qc));
        emit QuantumCatch.Transfer(alice, address(0), id);
        vm.prank(alice);
        qc.burn(id);
        assertEq(qc.balanceOf(alice), 0, "a burned net no longer counts");
        _gone(id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, N1104, alice));
        _cast(alice); // her net of tonight is used: burning it does not give her another
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id));
        qc.burn(id); // once
        vm.warp(LOCK_1104);
        uint256 next = _cast(alice); // the next night: a new net
        assertEq(qc.balanceOf(alice), 1);
        assertTrue(next != id);
    }

    function test_burn_by_an_approved_address_and_by_an_operator() public {
        vm.prank(alice);
        qc.approve(bob, id);
        vm.prank(bob);
        qc.burn(id);
        _gone(id);

        uint256 b = _cast(bob);
        address game = makeAddr("a later game");
        vm.prank(bob);
        qc.setApprovalForAll(game, true);
        vm.expectEmit(true, true, true, true, address(qc));
        emit QuantumCatch.Transfer(bob, address(0), b);
        vm.prank(game);
        qc.burn(b);
        _gone(b);
        assertEq(qc.balanceOf(bob), 0);
    }

    function test_nobody_else_burns() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, bob, id));
        qc.burn(id);
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, hatcher, id));
        qc.burn(id);
        // an approval for one net is not for another; an old holder's operator no longer counts after a transfer
        uint256 b = _cast(bob);
        vm.prank(alice);
        qc.approve(carol, id);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, carol, b));
        qc.burn(b);
        vm.prank(alice);
        qc.setApprovalForAll(carol, true);
        vm.prank(alice);
        qc.transferFrom(alice, bob, id);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, carol, id));
        qc.burn(id); // alice's operator, but bob holds it now (and the transfer cleared carol's approval)
        assertEq(qc.ownerOf(id), bob);
        assertEq(qc.balanceOf(bob), 2);
    }

    function test_a_given_away_net_burned_by_its_new_holder_still_blocks_the_caster() public {
        vm.prank(alice);
        qc.transferFrom(alice, bob, id);
        vm.prank(bob);
        qc.burn(id);
        _gone(id);
        assertEq(qc.balanceOf(alice), 0);
        assertEq(qc.balanceOf(bob), 0);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, N1104, alice));
        _cast(alice);
        uint256 b = _cast(bob); // bob's own net of tonight is still his to cast
        assertEq(qc.ownerOf(b), bob);
    }

    function test_burn_after_the_post_and_the_approval_is_cleared() public {
        vm.prank(alice);
        qc.approve(bob, id);
        _post1104();
        vm.prank(alice);
        qc.burn(id);
        _gone(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id));
        qc.transferFrom(alice, bob, id);
    }
}

/// traitsOf: one stable read for later games, the same facts as result() and the tokenURI attributes
contract TraitsTest is TraitsRead {
    string internal constant JSON_PREFIX = "data:application/json;base64,";

    function _json(uint256 t) internal view returns (string memory) {
        string memory uri = qc.tokenURI(t);
        return string(T.b64decode(T.after_(uri, bytes(JSON_PREFIX).length)));
    }

    function _key(string memory j, string memory name) internal view returns (string memory) {
        return _attrKey(j, name);
    }

    /// a string attribute's value, or "" when the net has no such attribute
    function _attr(string memory j, string memory name) internal view returns (string memory) {
        string memory key = _key(j, name);
        return bytes(key).length == 0 ? "" : vm.parseJsonString(j, key);
    }

    function _same(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _check(uint256 t) internal view {
        Traits memory x = _traits(t);
        (uint8 status, uint32 rn, uint8 rspot,,, uint8 rtier, uint8 looks) = qc.result(t);
        assertEq(x.night, rn);
        assertEq(x.night, uint32(t >> 160));
        assertEq(x.posted, status == 1 || status == 2 || status == 3);
        assertEq(x.caught, status == 1);
        assertEq(x.tier, rtier);
        uint8 bits = (x.hat ? 1 : 0) | (x.glasses ? 2 : 0) | (x.scarf ? 4 : 0) | (x.grin ? 8 : 0);
        assertEq(bits, looks, "the look bits = result().looks");
        if (!x.posted) assertEq(x.spot, 0, "before the post: the rest zero");
        else assertEq(x.spot, rspot);
        if (x.caught) assertEq(bits, x.spot, "the caught hamster's looks are its spot");
        else assertEq(bits, 0, "no hamster, no looks");
        _checkJson(x, _json(t), rspot);
    }

    function _checkJson(Traits memory x, string memory j, uint8 rspot) internal view {
        if (rspot < 16) assertEq(vm.parseJsonUint(j, _key(j, "Spot")), x.spot, "Spot attribute = the drawn spot");
        else assertEq(bytes(_key(j, "Spot")).length, 0, "no Spot attribute before the draw (or when he slept)");
        if (x.caught) {
            assertTrue(_same(_attr(j, "Hat"), x.hat ? "Yes" : "No"));
            assertTrue(_same(_attr(j, "Glasses"), x.glasses ? "Yes" : "No"));
            assertTrue(_same(_attr(j, "Neckwear"), x.scarf ? "Yes" : "No"));
            assertTrue(_same(_attr(j, "Face"), x.grin ? "Grin" : "Calm"));
        } else {
            assertEq(bytes(_attr(j, "Hat")).length, 0, "no look attributes unless caught");
            assertEq(bytes(_attr(j, "Face")).length, 0);
        }
        string[6] memory names = ["None", "Common", "Uncommon", "Rare", "Epic", "Legendary"];
        assertTrue(_same(_attr(j, "Tier"), names[x.tier]));
    }

    function test_traits_before_the_post() public {
        uint256 t = _cast(alice);
        Traits memory x = _traits(t);
        assertEq(x.night, N1104);
        assertFalse(x.posted);
        assertFalse(x.caught);
        assertEq(x.spot, 0);
        assertFalse(x.hat || x.glasses || x.scarf || x.grin);
        assertEq(x.tier, 0);
        _check(t);
        vm.warp(qc.postDeadline(N1104)); // no chip result for good: still not posted
        assertFalse(_traits(t).posted);
        _check(t);
    }

    function test_traits_caught_and_got_away_match_result_and_the_metadata() public {
        uint16[16] memory c = _counts1104v12();
        uint8[6] memory spots = [uint8(15), 1, 11, 7, 0, 6]; // caught x4 (15: all 4 looks), out of reach x2
        uint256[6] memory ids;
        for (uint256 k; k < 6; ++k) {
            ids[k] = _castOn(spots[k], c);
        }
        vm.warp(OVER_1104);
        _postF(N1104, c, TURNS_1104, STEPS_1104_V12, 7);
        for (uint256 k; k < 6; ++k) {
            _check(ids[k]);
            Traits memory x = _traits(ids[k]);
            assertTrue(x.posted);
            assertEq(x.spot, spots[k]);
            assertEq(x.caught, spots[k] % 2 == 1);
        }
        Traits memory a = _traits(ids[0]);
        assertEq(a.spot, 15);
        assertTrue(a.hat && a.glasses && a.scarf && a.grin);
        assertEq(a.tier, 1);
        assertEq(_traits(ids[3]).tier, 5, "spot 7: the Epic spot with the first shot");
        Traits memory away = _traits(ids[4]);
        assertFalse(away.caught);
        assertEq(away.spot, 0, "the shot's spot, also when it got away");
        assertFalse(away.hat || away.glasses || away.scarf || away.grin);
    }

    function test_traits_of_a_slept_night() public {
        uint256 t = _cast(alice);
        vm.warp(OVER_1104);
        uint16[16] memory zero;
        _postK(N1104, zero, 0, 0);
        Traits memory x = _traits(t);
        assertTrue(x.posted);
        assertFalse(x.caught);
        assertEq(x.spot, 255, "he slept: no shot drawn");
        assertEq(x.tier, 0);
        _check(t);
    }

    function testFuzz_traits_match_result(address who, uint16[16] memory c, uint32 turns) public {
        vm.assume(who != address(0) && who != hatcher);
        assumeNotForgeAddress(who);
        uint256 sum;
        for (uint256 s; s < 16; ++s) {
            sum += c[s];
        }
        if (turns == 0) c = [uint16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        else if (sum == 0) c[uint160(who) % 16] = 1;
        uint256 t = _cast(who);
        vm.warp(OVER_1104);
        _post(N1104, c, turns);
        _check(t);
    }
}
