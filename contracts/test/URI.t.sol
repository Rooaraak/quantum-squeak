// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {CatchBase} from "./Base.t.sol";
import {QuantumCatch} from "../src/QuantumCatch.sol";
import {CatchLib} from "../src/CatchLib.sol";

/// Test-only helpers: base64 decoding and string search.
library T {
    function b64decode(string memory s) internal pure returns (bytes memory out) {
        bytes memory d = bytes(s);
        require(d.length % 4 == 0, "b64 length");
        uint256 pad;
        if (d.length > 0 && d[d.length - 1] == "=") pad++;
        if (d.length > 1 && d[d.length - 2] == "=") pad++;
        out = new bytes((d.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i; i < d.length; i += 4) {
            uint256 n = (_v(d[i]) << 18) | (_v(d[i + 1]) << 12) | (_v(d[i + 2]) << 6) | _v(d[i + 3]);
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
    }

    function _v(bytes1 c) private pure returns (uint256) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65;
        if (x >= 97 && x <= 122) return x - 71;
        if (x >= 48 && x <= 57) return x + 4;
        if (x == 43) return 62;
        if (x == 47) return 63;
        if (x == 61) return 0;
        revert("b64 char");
    }

    function startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        for (uint256 i; i < b.length; ++i) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function endsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        uint256 off = a.length - b.length;
        for (uint256 i; i < b.length; ++i) {
            if (a[off + i] != b[i]) return false;
        }
        return true;
    }

    function contains(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        for (uint256 i; i <= a.length - b.length; ++i) {
            bool ok = true;
            for (uint256 j; j < b.length; ++j) {
                if (a[i + j] != b[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function after_(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory a = bytes(s);
        bytes memory out = new bytes(a.length - n);
        for (uint256 i; i < out.length; ++i) {
            out[i] = a[n + i];
        }
        return string(out);
    }
}

contract LibHarness {
    function civil(uint256 days_) external pure returns (uint256, uint256, uint256) {
        return CatchLib.civil(days_);
    }

    function dateString(uint256 days_) external pure returns (string memory) {
        return CatchLib.dateString(days_);
    }

    function toString(uint256 v) external pure returns (string memory) {
        return CatchLib.toString(v);
    }

    function base64(bytes memory b) external pure returns (string memory) {
        return CatchLib.base64(b);
    }
}

contract CatchLibTest is CatchBase {
    LibHarness internal h;

    function setUp() public override {
        super.setUp();
        h = new LibHarness();
    }

    function test_civil_date_fixtures() public view {
        assertEq(h.dateString(0), "1970-01-01");
        assertEq(h.dateString(10956), "1999-12-31");
        assertEq(h.dateString(11016), "2000-02-29");
        assertEq(h.dateString(19782), "2024-02-29");
        assertEq(h.dateString(20761), "2026-11-04");
        assertEq(h.dateString(47540), "2100-02-28");
        assertEq(h.dateString(47541), "2100-03-01"); // 2100 is not a leap year
        assertEq(h.dateString(2932896), "9999-12-31");
    }

    /// Hinnant days_from_civil, the inverse, written independently here.
    function _daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        if (m <= 2) y -= 1;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    function testFuzz_civil_round_trip(uint32 days_) public view {
        uint256 z = bound(days_, 0, 2932896);
        (uint256 y, uint256 m, uint256 d) = h.civil(z);
        assertGe(m, 1);
        assertLe(m, 12);
        assertGe(d, 1);
        assertLe(d, 31);
        assertEq(_daysFromCivil(y, m, d), z);
        if (z > 0) {
            (uint256 y0, uint256 m0, uint256 d0) = h.civil(z - 1);
            assertTrue(y0 < y || (y0 == y && (m0 < m || (m0 == m && d0 + 1 == d))), "dates increase by one day");
        }
    }

    function test_toString() public view {
        assertEq(h.toString(0), "0");
        assertEq(h.toString(7), "7");
        assertEq(h.toString(4000), "4000");
        assertEq(h.toString(type(uint256).max), vm.toString(type(uint256).max));
    }

    function testFuzz_toString(uint256 v) public view {
        assertEq(h.toString(v), vm.toString(v));
    }

    function test_base64_fixtures() public view {
        assertEq(h.base64(""), "");
        assertEq(h.base64("f"), "Zg==");
        assertEq(h.base64("fo"), "Zm8=");
        assertEq(h.base64("foo"), "Zm9v");
        assertEq(h.base64("foobar"), "Zm9vYmFy");
    }

    /// large inputs (the painted images are about 100 KB) and every length near the 24-byte word steps
    function test_base64_large_inputs_match_forge() public view {
        bytes memory big = new bytes(100_003);
        for (uint256 i; i < big.length; i += 32) {
            bytes32 r = keccak256(abi.encode(i));
            for (uint256 k; k < 32 && i + k < big.length; ++k) {
                big[i + k] = r[k];
            }
        }
        uint256 g = gasleft();
        string memory e = h.base64(big);
        g -= gasleft();
        console2.log("base64 of 100,003 bytes: gas", g);
        assertEq(keccak256(bytes(e)), keccak256(bytes(vm.toBase64(big))));
        for (uint256 n; n <= 100; ++n) {
            bytes memory b = new bytes(n);
            for (uint256 k; k < n; ++k) {
                b[k] = big[k * 7 + n];
            }
            assertEq(h.base64(b), vm.toBase64(b), vm.toString(n));
        }
    }

    function testFuzz_base64_matches_forge(bytes memory b) public view {
        string memory e = h.base64(b);
        assertEq(e, vm.toBase64(b));
        assertEq(T.b64decode(e), b);
    }
}

contract TokenURITest is CatchBase {
    string internal constant JSON_PREFIX = "data:application/json;base64,";
    string internal constant SVG_PREFIX = "data:image/svg+xml;base64,";
    string internal constant TAIL = "Landings,Shots,IBM job,Steps,Reach,Result sha256,First shot";

    function _json(uint256 id) internal view returns (string memory j) {
        string memory uri = qc.tokenURI(id);
        assertTrue(T.startsWith(uri, JSON_PREFIX), "json data uri");
        j = string(T.b64decode(T.after_(uri, bytes(JSON_PREFIX).length)));
    }

    function _svg(string memory j) internal pure returns (string memory s) {
        string memory img = vm.parseJsonString(j, ".image");
        assertTrue(T.startsWith(img, SVG_PREFIX), "svg data uri");
        s = string(T.b64decode(T.after_(img, bytes(SVG_PREFIX).length)));
        assertTrue(T.startsWith(s, "<svg xmlns=\"http://www.w3.org/2000/svg\""), "svg root");
        assertTrue(T.endsWith(s, "</svg>"), "svg end");
    }

    function _str(string memory j, string memory name) internal view returns (string memory) {
        return vm.parseJsonString(j, _attrKey(j, name));
    }

    function _uint(string memory j, string memory name) internal view returns (uint256) {
        return vm.parseJsonUint(j, _attrKey(j, name));
    }

    /// the attributes a net has: Spot once its shot is drawn, the 4 looks only when caught (and then they are the
    /// drawn spot's bits)
    function _checkTraits(string memory j, uint8 spot, bool caught) internal view {
        string memory want = string.concat(
            "Night,",
            spot < 16 ? "Spot," : "",
            "Status,Tier,",
            caught ? "Hat,Glasses,Neckwear,Face," : "",
            TAIL
        );
        assertEq(_traitTypes(j), want);
        if (spot < 16) assertEq(_uint(j, "Spot"), spot);
        if (!caught) return;
        string[4] memory bits = ["Hat", "Glasses", "Neckwear", "Face"];
        for (uint256 b; b < 4; ++b) {
            string memory v = (spot >> b) & 1 == 1 ? (b == 3 ? "Grin" : "Yes") : (b == 3 ? "Calm" : "No");
            assertEq(_str(j, bits[b]), v, bits[b]);
        }
    }

    function test_waiting_token() public {
        uint256 id = _cast(alice);
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".name"), "Quantum Catch: night of 2026-11-04", "no spot before the draw");
        string memory d = vm.parseJsonString(j, ".description");
        assertTrue(T.startsWith(d, "Sepolia test NFT, no value. A net for one night"), d);
        assertFalse(T.contains(d, "Free"), "a v2 net may have cost test SQK: the card never says free");
        assertFalse(T.contains(d, "Its shot landed"), "nothing drawn yet");
        _checkTraits(j, 255, false);
        assertEq(_str(j, "Night"), "2026-11-04");
        assertEq(_str(j, "Status"), "Waiting for the chip");
        assertEq(_str(j, "Tier"), "None");
        assertEq(_uint(j, "Landings"), 0);
        assertEq(_uint(j, "Shots"), 0);
        assertEq(_str(j, "IBM job"), "none");
        assertEq(_str(j, "First shot"), "none");
        string memory s = _svg(j);
        assertTrue(T.contains(s, "WAITING FOR THE CHIP"));
        assertTrue(T.contains(s, "night of 2026-11-04<tspan x=\"160\" dy=\"12\">its spot is drawn after the run</tspan>"));
        assertTrue(T.contains(s, "<text x=\"160\" y=\"236\""), "the two-line caption sits 10 px higher");
        assertFalse(T.contains(s, "id=\"mynet\""), "no net on the ring before the draw");
        assertFalse(T.contains(s, "id=\"hat\""), "no traits shown before the catch");
    }

    function test_caught_token() public {
        // 0b0101: hat, no glasses, scarf, calm face. 4 Nov v1 (14 steps, odd spots in reach): 15 (808) 3 (705) 1 (693)
        // 9 (383) 7 (368) 5 (308) 13 (292) 11 (289): spot 5 ranks 6 of 8 = Uncommon
        uint256 id = _castOn(5, _counts1104());
        _post1104();
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".name"), "Quantum Catch: night of 2026-11-04, spot 5");
        _checkTraits(j, 5, true);
        assertEq(_str(j, "Status"), "Caught");
        assertEq(_str(j, "Tier"), "Uncommon");
        assertEq(_uint(j, "Landings"), 308);
        assertEq(_uint(j, "Shots"), 4000);
        assertEq(_str(j, "IBM job"), "dbmaa9u74qds73dru4d0");
        assertEq(_str(j, "First shot"), "spot 15");
        assertTrue(
            T.startsWith(
                vm.parseJsonString(j, ".description"),
                "Sepolia test NFT, no value. Its shot landed on spot 5. Caught: rank 6 of the 8 catchable spots tonight by landings, most first. A net"
            )
        );
        string memory s = _svg(j);
        assertTrue(T.contains(s, "CAUGHT"));
        assertTrue(T.contains(s, "UNCOMMON"));
        assertTrue(T.contains(s, "id=\"mynet\""), "the dashed net on the drawn spot");
        assertTrue(
            T.contains(s, "stroke-dasharray=\"4 3\" transform=\"rotate(112.5 160 160)\"/>"), "my net on spot 5 (112.5 degrees)"
        );
        assertTrue(T.contains(s, "id=\"hat\""));
        assertFalse(T.contains(s, "id=\"glasses\""));
        assertTrue(T.contains(s, "id=\"scarf\""));
        assertTrue(T.contains(s, "id=\"calm\""));
        assertFalse(T.contains(s, "id=\"grin\""));
    }

    function test_caught_other_looks_and_every_tier_name() public {
        uint256 id = _castOn(10, _counts1104()); // 0b1010: glasses + grin
        _post1104(); // spot 10: 18 / 4000, out of reach -> got away
        string memory s = _svg(_json(id));
        assertTrue(T.contains(s, "GOT AWAY"));

        // 9 turns, 9 steps: start 9, every even spot in reach. The other 7 even spots get 800 700 600 500 400 300 200;
        // spot 10's landings put it at rank 1 (Common), 5 (Uncommon), 7 (Rare) or 8 (Epic; Legendary when the first
        // shot is on it)
        string[6] memory tierName = ["None", "Common", "Uncommon", "Rare", "Epic", "Legendary"];
        uint16[6] memory hits = [uint16(0), 900, 450, 250, 100, 100];
        string[6] memory note = ["", "rank 1 of", "rank 5 of", "rank 7 of", "rank 8 of", "rank 8 of"];
        for (uint256 k = 1; k < 6; ++k) {
            uint32 n = N1104 + uint32(k);
            uint16[16] memory c;
            uint16[7] memory rest = [uint16(800), 700, 600, 500, 400, 300, 200];
            uint256 r;
            for (uint256 sp; sp < 16; sp += 2) {
                if (sp != 10) c[sp] = rest[r++];
            }
            c[10] = hits[k];
            vm.warp(qc.nightStart(n) + 60);
            uint256 t = _castOn(10, c);
            vm.warp(qc.nightOverAt(n));
            _postF(n, c, 9, 9, k == 5 ? 10 : 0);
            string memory j = _json(t);
            assertEq(_str(j, "Tier"), tierName[k]);
            string memory d = vm.parseJsonString(j, ".description");
            assertTrue(T.contains(d, string.concat("Caught: ", note[k], " the 8 catchable spots tonight")), d);
            assertEq(T.contains(d, "The chip's very first shot of the night landed here."), k == 5);
            assertEq(_str(j, "First shot"), k == 5 ? "spot 10" : "spot 0");
            s = _svg(j);
            assertTrue(T.contains(s, "id=\"glasses\""));
            assertTrue(T.contains(s, "id=\"grin\""));
            assertFalse(T.contains(s, "id=\"hat\""));
            assertFalse(T.contains(s, "id=\"scarf\""));
        }
    }

    function test_got_away_token() public {
        uint256 id = _castOn(0, _counts1104()); // 27 / 4000, out of reach on 4 Nov (0 + 3817 + 14 odd)
        _post1104();
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".name"), "Quantum Catch: night of 2026-11-04, spot 0");
        _checkTraits(j, 0, false);
        assertEq(_str(j, "Status"), "Got away");
        assertEq(_str(j, "Tier"), "None");
        assertEq(_uint(j, "Landings"), 27);
        assertEq(_str(j, "Reach"), "Out of reach tonight");
        assertTrue(
            T.contains(
                vm.parseJsonString(j, ".description"),
                "Its shot landed on spot 0. Out of reach tonight: he could not land here; the 27 landings here are the chip's noise."
            )
        );
        string memory s = _svg(j);
        assertTrue(T.contains(s, "GOT AWAY"));
        assertTrue(T.contains(s, "id=\"outofreach\""));
        assertTrue(T.contains(s, "27 of 4000 shots: chip noise"));
        assertTrue(T.contains(s, "id=\"mynet\""), "where its shot landed");
    }

    function test_slept_token() public {
        uint256 id = _cast(alice);
        vm.warp(OVER_1104);
        uint16[16] memory zero;
        vm.prank(hatcher);
        qc.postNight(N1104, zero, 0, 0, 0, 0, 0);
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".name"), "Quantum Catch: night of 2026-11-04");
        _checkTraits(j, 255, false);
        assertEq(_str(j, "Status"), "He slept");
        assertEq(_str(j, "First shot"), "none");
        assertEq(_str(j, "IBM job"), "none");
        string memory s = _svg(j);
        assertTrue(T.contains(s, "HE SLEPT"));
        assertTrue(T.contains(s, "zzz"));
        assertFalse(T.contains(s, "id=\"mynet\""), "nothing drawn");
    }

    function test_unsafe_job_id_is_shown_as_hex_and_json_stays_valid() public {
        uint256 id = _cast(alice);
        vm.warp(OVER_1104);
        bytes32 bad = bytes32(bytes("a\"b\\c</svg>"));
        vm.prank(hatcher);
        qc.postNight(N1104, _counts1104(), TURNS_1104, STEPS_1104, bad, SHA_1104, FIRST_1104);
        string memory j = _json(id);
        assertEq(_str(j, "IBM job"), vm.toString(bad));
        // a zero byte in the middle is not padding: also hex
        bytes32 holey = bytes32(bytes.concat(bytes("ab"), bytes1(0), bytes("cd")));
        vm.warp(qc.nightStart(N1104 + 1) + 60);
        uint256 id2 = _cast(alice);
        vm.warp(qc.nightOverAt(N1104 + 1));
        vm.prank(hatcher);
        qc.postNight(N1104 + 1, _counts1104(), TURNS_1104, STEPS_1104, holey, SHA_1104, FIRST_1104);
        assertEq(_str(_json(id2), "IBM job"), vm.toString(holey));
    }

    function test_tokenURI_missing_token_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, uint256(42)));
        qc.tokenURI(42);
    }

    function testFuzz_tokenURI_is_valid_json_in_every_state(address who, uint16 hits, uint8 hot, uint8 state) public {
        vm.assume(who != address(0) && who != hatcher);
        assumeNotForgeAddress(who);
        uint256 id = _cast(who);
        state = uint8(bound(state, 0, 3)); // waiting, ran (odd spots in reach, even ones out), slept, no chip result
        hot = uint8(bound(hot, 0, 15));
        uint16[16] memory c;
        if (state == 3) {
            vm.warp(qc.postDeadline(N1104));
        } else if (state > 0) {
            vm.warp(OVER_1104);
            uint32 turns;
            if (state == 1) {
                c[hot] = uint16(bound(hits, 1, 4000));
                c[(hot + 1) % 16] = 4000 - c[hot];
                turns = 77;
            }
            _post(N1104, c, turns);
        }
        string memory j = _json(id);
        vm.parseJson(j); // reverts on invalid JSON
        uint8 spot = state == 1 ? _refDraw(N1104, SHA_1104, JOB_1104, id, c) : 255;
        assertEq(
            vm.parseJsonString(j, ".name"),
            spot < 16
                ? string.concat("Quantum Catch: night of 2026-11-04, spot ", vm.toString(spot))
                : "Quantum Catch: night of 2026-11-04"
        );
        (uint8 status,,,,,,) = qc.result(id);
        _checkTraits(j, spot, status == 1);
        string memory s = _svg(j);
        bool out = state == 1 && spot % 2 == 0; // 77 turns, 10 steps
        assertEq(T.contains(vm.parseJsonString(j, ".description"), "Out of reach tonight:"), out);
        assertEq(T.contains(s, "id=\"outofreach\""), out);
        assertEq(T.contains(s, "id=\"mynet\""), spot < 16);
        if (out) assertEq(_str(j, "Status"), "Got away");
        assertFalse(T.contains(j, "noise hatch"));
        assertFalse(T.contains(s, "NOISE HATCH"));
    }
}
