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

    function _attr(string memory, uint256 i) internal pure returns (string memory key) {
        key = string.concat(".attributes[", vm.toString(i), "]");
    }

    function _checkTraits(string memory j, uint256 spot) internal pure {
        string[15] memory names = [
            "Night",
            "Spot",
            "Status",
            "Tier",
            "Hat",
            "Glasses",
            "Neckwear",
            "Face",
            "Landings",
            "Shots",
            "IBM job",
            "Steps",
            "Reach",
            "Result sha256",
            "First shot"
        ];
        for (uint256 i; i < names.length; ++i) {
            assertEq(vm.parseJsonString(j, string.concat(_attr(j, i), ".trait_type")), names[i]);
        }
        assertEq(vm.parseJsonUint(j, string.concat(_attr(j, 1), ".value")), spot);
        string[4] memory bits = ["Hat", "Glasses", "Neckwear", "Face"];
        for (uint256 b; b < 4; ++b) {
            string memory want = (spot >> b) & 1 == 1 ? (b == 3 ? "Grin" : "Yes") : (b == 3 ? "Calm" : "No");
            assertEq(vm.parseJsonString(j, string.concat(_attr(j, 4 + b), ".value")), want, bits[b]);
        }
    }

    function test_waiting_token() public {
        uint256 id = _cast(alice, 5);
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".name"), "Quantum Catch: night of 2026-11-04, spot 5");
        assertTrue(T.startsWith(vm.parseJsonString(j, ".description"), "Free Sepolia test NFT, no value."));
        _checkTraits(j, 5);
        assertEq(vm.parseJsonString(j, ".attributes[0].value"), "2026-11-04");
        assertEq(vm.parseJsonString(j, ".attributes[2].value"), "Waiting for the chip");
        assertEq(vm.parseJsonString(j, ".attributes[3].value"), "None");
        assertEq(vm.parseJsonUint(j, ".attributes[8].value"), 0);
        assertEq(vm.parseJsonUint(j, ".attributes[9].value"), 0);
        assertEq(vm.parseJsonString(j, ".attributes[10].value"), "none");
        assertEq(vm.parseJsonString(j, ".attributes[14].value"), "none");
        string memory s = _svg(j);
        assertTrue(T.contains(s, "WAITING FOR THE CHIP"));
        assertFalse(T.contains(s, "id=\"hat\""), "no traits shown before the catch");
    }

    function test_caught_token() public {
        // 0b0101: hat, no glasses, scarf, calm face. 4 Nov v1 (14 steps, odd spots in reach): 15 (808) 3 (705) 1 (693)
        // 9 (383) 7 (368) 5 (308) 13 (292) 11 (289): spot 5 ranks 6 of 8 = Uncommon
        uint256 id = _cast(alice, 5);
        _post1104();
        string memory j = _json(id);
        _checkTraits(j, 5);
        assertEq(vm.parseJsonString(j, ".attributes[2].value"), "Caught");
        assertEq(vm.parseJsonString(j, ".attributes[3].value"), "Uncommon");
        assertEq(vm.parseJsonUint(j, ".attributes[8].value"), 308);
        assertEq(vm.parseJsonUint(j, ".attributes[9].value"), 4000);
        assertEq(vm.parseJsonString(j, ".attributes[10].value"), "dbmaa9u74qds73dru4d0");
        assertEq(vm.parseJsonString(j, ".attributes[14].value"), "spot 15");
        assertTrue(
            T.startsWith(
                vm.parseJsonString(j, ".description"),
                "Free Sepolia test NFT, no value. Caught: rank 6 of the 8 catchable spots tonight by landings, most first. A net"
            )
        );
        string memory s = _svg(j);
        assertTrue(T.contains(s, "CAUGHT"));
        assertTrue(T.contains(s, "UNCOMMON"));
        assertTrue(T.contains(s, "id=\"hat\""));
        assertFalse(T.contains(s, "id=\"glasses\""));
        assertTrue(T.contains(s, "id=\"scarf\""));
        assertTrue(T.contains(s, "id=\"calm\""));
        assertFalse(T.contains(s, "id=\"grin\""));
    }

    function test_caught_other_looks_and_every_tier_name() public {
        uint256 id = _cast(alice, 10); // 0b1010: glasses + grin
        _post1104(); // spot 10: 18 / 4000 -> got away
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
            vm.warp(qc.nightStart(n) + 60);
            uint256 t = _cast(bob, 10);
            vm.warp(qc.nightOverAt(n));
            uint16[16] memory c;
            uint16[7] memory rest = [uint16(800), 700, 600, 500, 400, 300, 200];
            uint256 r;
            for (uint256 sp; sp < 16; sp += 2) {
                if (sp != 10) c[sp] = rest[r++];
            }
            c[10] = hits[k];
            _postF(n, c, 9, 9, k == 5 ? 10 : 0);
            string memory j = _json(t);
            assertEq(vm.parseJsonString(j, ".attributes[3].value"), tierName[k]);
            string memory d = vm.parseJsonString(j, ".description");
            assertTrue(T.contains(d, string.concat("Caught: ", note[k], " the 8 catchable spots tonight")), d);
            assertEq(T.contains(d, "The chip's very first shot of the night landed here."), k == 5);
            assertEq(vm.parseJsonString(j, ".attributes[14].value"), k == 5 ? "spot 10" : "spot 0");
            s = _svg(j);
            assertTrue(T.contains(s, "id=\"glasses\""));
            assertTrue(T.contains(s, "id=\"grin\""));
            assertFalse(T.contains(s, "id=\"hat\""));
            assertFalse(T.contains(s, "id=\"scarf\""));
        }
    }

    function test_got_away_token() public {
        uint256 id = _cast(alice, 0); // 27 / 4000, out of reach on 4 Nov (0 + 3817 + 14 odd)
        _post1104();
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".attributes[2].value"), "Got away");
        assertEq(vm.parseJsonString(j, ".attributes[3].value"), "None");
        assertEq(vm.parseJsonUint(j, ".attributes[8].value"), 27);
        assertEq(vm.parseJsonString(j, ".attributes[12].value"), "Out of reach tonight");
        assertTrue(
            T.contains(
                vm.parseJsonString(j, ".description"),
                "Out of reach tonight: he could not land here; the 27 landings here are the chip's noise."
            )
        );
        string memory s = _svg(j);
        assertTrue(T.contains(s, "GOT AWAY"));
        assertTrue(T.contains(s, "id=\"outofreach\""));
        assertTrue(T.contains(s, "27 of 4000 shots: chip noise"));
    }

    function test_slept_token() public {
        uint256 id = _cast(alice, 9);
        vm.warp(OVER_1104);
        uint16[16] memory zero;
        vm.prank(hatcher);
        qc.postNight(N1104, zero, 0, 0, 0, 0, 0);
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".attributes[2].value"), "He slept");
        assertEq(vm.parseJsonString(j, ".attributes[14].value"), "none");
        assertEq(vm.parseJsonString(j, ".attributes[10].value"), "none");
        string memory s = _svg(j);
        assertTrue(T.contains(s, "HE SLEPT"));
        assertTrue(T.contains(s, "zzz"));
    }

    function test_unsafe_job_id_is_shown_as_hex_and_json_stays_valid() public {
        uint256 id = _cast(alice, 1);
        vm.warp(OVER_1104);
        bytes32 bad = bytes32(bytes("a\"b\\c</svg>"));
        vm.prank(hatcher);
        qc.postNight(N1104, _counts1104(), TURNS_1104, STEPS_1104, bad, SHA_1104, FIRST_1104);
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, ".attributes[10].value"), vm.toString(bad));
        // a zero byte in the middle is not padding: also hex
        bytes32 holey = bytes32(bytes.concat(bytes("ab"), bytes1(0), bytes("cd")));
        vm.warp(OVER_1104 + 1 days);
        vm.warp(qc.nightStart(N1104 + 1) + 60);
        uint256 id2 = _cast(alice, 1);
        vm.warp(qc.nightOverAt(N1104 + 1));
        vm.prank(hatcher);
        qc.postNight(N1104 + 1, _counts1104(), TURNS_1104, STEPS_1104, holey, SHA_1104, FIRST_1104);
        assertEq(vm.parseJsonString(_json(id2), ".attributes[10].value"), vm.toString(holey));
    }

    function test_tokenURI_missing_token_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, uint256(42)));
        qc.tokenURI(42);
    }

    function testFuzz_tokenURI_is_valid_json_in_every_state(uint8 spot, uint16 hits, uint8 state) public {
        spot = uint8(bound(spot, 0, 15));
        uint256 id = _cast(alice, spot);
        state = uint8(bound(state, 0, 3)); // waiting, ran (odd spots in reach, even ones out), slept, no chip result
        if (state == 3) {
            vm.warp(qc.postDeadline(N1104));
        } else if (state > 0) {
            vm.warp(OVER_1104);
            uint16[16] memory c;
            uint32 turns;
            if (state == 1) {
                c[spot] = uint16(bound(hits, 0, 4000));
                c[(spot + 1) % 16] = 4000 - c[spot];
                turns = 77;
            }
            _post(N1104, c, turns);
        }
        string memory j = _json(id);
        vm.parseJson(j); // reverts on invalid JSON
        assertEq(
            vm.parseJsonString(j, ".name"),
            string.concat("Quantum Catch: night of 2026-11-04, spot ", vm.toString(spot))
        );
        _checkTraits(j, spot);
        string memory s = _svg(j);
        bool out = state == 1 && spot % 2 == 0; // 77 turns, 10 steps
        assertEq(T.contains(vm.parseJsonString(j, ".description"), "Out of reach tonight:"), out);
        assertEq(T.contains(s, "id=\"outofreach\""), out);
        if (out) assertEq(vm.parseJsonString(j, ".attributes[2].value"), "Got away");
        assertFalse(T.contains(j, "noise hatch"));
        assertFalse(T.contains(s, "NOISE HATCH"));
    }
}
