// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {CatchBase} from "./Base.t.sol";
import {ArtChunks} from "./ArtChunks.sol";
import {T} from "./URI.t.sol";
import {QuantumCatch, IPaintedArt} from "../src/QuantumCatch.sol";
import {CatchArt} from "../src/CatchArt.sol";
import {PaintedArt} from "../src/PaintedArt.sol";

/// an art contract that always reverts: the net must still render (the small drawn hamster)
contract RevertingArt {
    function hamster(uint8, uint8) external pure returns (string memory) {
        revert("no art");
    }
}

/// QuantumCatch with the real painted art (the 15 ArtChunk data contracts + PaintedArt), as script/DeployAll.s.sol
/// deploys it: a caught net's image is the painted hamster of its spot in its tier's skin, exactly PaintedArt's fragment,
/// placed where the drawn hamster stands; every other state draws no painted hamster. And the worst tokenURI stays far
/// under a 30M-gas eth_call.
contract PaintedCatchTest is CatchBase, ArtChunks {
    string internal constant JSON_PREFIX = "data:application/json;base64,";
    string internal constant SVG_PREFIX = "data:image/svg+xml;base64,";
    string internal constant PAINTED_AT = '<g id="painted" transform="translate(70.4 14.4) scale(.4)">';
    string internal constant FALLBACK_AT = '<g id="fallback" transform="translate(84.7 89) scale(.48)">';
    uint256 internal constant ETH_CALL_CAP = 30_000_000;

    PaintedArt internal art;

    function setUp() public override {
        art = new PaintedArt(_deployChunks());
        qc = new QuantumCatch(hatcher, IPaintedArt(address(art)));
        vm.warp(START_1104 + 3600);
    }

    /// base64 decoding in assembly (the painted tokenURIs are about 180 KB: the plain test decoder is too slow)
    function _b64(string memory str) internal pure returns (bytes memory out) {
        bytes memory src = bytes(str);
        uint256 n = src.length;
        require(n % 4 == 0, "b64 length");
        uint256 pad = n == 0 ? 0 : (src[n - 1] == "=" ? 1 : 0) + (n > 1 && src[n - 2] == "=" ? 1 : 0);
        bytes memory rev = new bytes(256);
        bytes memory tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (uint256 i; i < 64; ++i) {
            rev[uint8(tbl[i])] = bytes1(uint8(i));
        }
        out = new bytes((n / 4) * 3 + 32); // room for the last group's 3 bytes; the length is set below
        assembly ("memory-safe") {
            let r := add(rev, 0x20)
            let p := add(src, 0x20)
            let end := add(p, n)
            let d := add(out, 0x20)
            for {} lt(p, end) {} {
                let w := mload(p)
                let v := or(
                    or(shl(18, byte(0, mload(add(r, byte(0, w))))), shl(12, byte(0, mload(add(r, byte(1, w)))))),
                    or(shl(6, byte(0, mload(add(r, byte(2, w))))), byte(0, mload(add(r, byte(3, w)))))
                )
                mstore8(d, shr(16, v))
                mstore8(add(d, 1), shr(8, v))
                mstore8(add(d, 2), v)
                p := add(p, 4)
                d := add(d, 3)
            }
            mstore(out, sub(div(mul(n, 3), 4), pad))
        }
    }

    function _svgOf(uint256 id) internal view returns (bytes memory) {
        return _svgOfUri(qc.tokenURI(id));
    }

    function _svgOfUri(string memory uri) internal pure returns (bytes memory) {
        assertTrue(T.startsWith(uri, JSON_PREFIX));
        string memory j = string(_b64(T.after_(uri, bytes(JSON_PREFIX).length)));
        vm.parseJson(j); // valid JSON
        string memory img = vm.parseJsonString(j, ".image");
        assertTrue(T.startsWith(img, SVG_PREFIX));
        return _b64(T.after_(img, bytes(SVG_PREFIX).length));
    }

    /// the first index of a short needle in s[from, to), or type(uint256).max
    function _find(bytes memory s, bytes memory needle, uint256 from, uint256 to) internal pure returns (uint256) {
        if (to > s.length) to = s.length;
        for (uint256 i = from; i + needle.length <= to; ++i) {
            bool ok = true;
            for (uint256 k; k < needle.length; ++k) {
                if (s[i + k] != needle[k]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return i;
        }
        return type(uint256).max;
    }

    function _find(bytes memory s, bytes memory needle) internal pure returns (uint256) {
        return _find(s, needle, 0, s.length);
    }

    function _hashAt(bytes memory s, uint256 at, uint256 len) internal pure returns (bytes32 h) {
        require(at + len <= s.length, "slice");
        assembly ("memory-safe") {
            h := keccak256(add(add(s, 0x20), at), len)
        }
    }

    /// the image is the card with <g id="painted" ...> + art.hamster(spot, tier) + </g> where the drawn hamster
    /// stands (after the ring of dots and my net, right before the caption), byte for byte, and no drawn hamster
    function _assertPainted(uint256 id, uint8 spot, uint8 tier) internal view {
        this.checkPainted(id, spot, tier); // its own call frame: each check decodes about 300 KB
    }

    function checkPainted(uint256 id, uint8 spot, uint8 tier) external view {
        bytes memory svg = _svgOf(id);
        bytes memory want = bytes(string.concat(PAINTED_AT, art.hamster(spot, tier), "</g>"));
        uint256 at = _find(svg, bytes(PAINTED_AT));
        assertTrue(at != type(uint256).max, "the painted group");
        assertEq(_hashAt(svg, at, want.length), keccak256(want), "exactly PaintedArt's fragment, closed");
        uint256 rest = at + want.length;
        bytes memory caption = '<text x="160" y="246" text-anchor="middle" font-size="13" font-weight="bold" fill="#26201c">CAUGHT &#183; ';
        assertEq(_hashAt(svg, rest, caption.length), keccak256(caption), "the caption right after");
        // under it, the WebP fallback: the drawn hamster with this spot's items at scale .48, wholly inside the painted
        // figure (covered pixel for pixel where WebP decodes; script/fallback-check.mjs), visible where it does not
        uint256 fb = _find(svg, bytes(FALLBACK_AT));
        assertTrue(fb != type(uint256).max, "the fallback group");
        assertTrue(_find(svg, bytes('<circle id="mynet"'), 0, fb) != type(uint256).max, "the ring and my net first");
        assertEq(_find(svg, bytes('<g id="hamster">'), 0, fb), type(uint256).max, "no drawn hamster before the fallback");
        uint256 inner = fb + bytes(FALLBACK_AT).length;
        assertEq(_find(svg, bytes('<g id="hamster">'), inner, inner + 16), inner, "the drawn hamster inside it");
        assertEq(_hashAt(svg, at - 4, 4), keccak256("</g>"), "the fallback closes right before the painted group");
        assertEq(_find(svg, bytes('<g id="hamster">'), inner + 16, svg.length), type(uint256).max, "one drawn hamster");
        assertEq(_find(svg, bytes("data:image"), fb, at), type(uint256).max, "the fallback is vector only");
        assertEq(_find(svg, bytes('<g id="hat">'), fb, at) != type(uint256).max, spot & 1 == 1, "hat iff bit 0");
        assertEq(_find(svg, bytes('<g id="glasses"'), fb, at) != type(uint256).max, (spot >> 1) & 1 == 1, "glasses iff bit 1");
        assertEq(_find(svg, bytes('<g id="scarf">'), fb, at) != type(uint256).max, (spot >> 2) & 1 == 1, "scarf iff bit 2");
        assertEq(_find(svg, bytes('id="grin"'), fb, at) != type(uint256).max, (spot >> 3) & 1 == 1, "grin iff bit 3");
        assertEq(_find(svg, bytes('<g id="hamster">'), rest, svg.length), type(uint256).max, "no drawn hamster");
        assertEq(_find(svg, bytes("<g id="), rest, svg.length), type(uint256).max, "nothing drawn over it");
    }

    function _assertNotPainted(uint256 id) internal view returns (bytes memory svg) {
        svg = _svgOf(id);
        assertEq(_find(svg, bytes('id="painted"')), type(uint256).max, "no painted hamster");
        assertEq(_find(svg, bytes("data:image/webp")), type(uint256).max, "no painted layer");
        assertEq(_find(svg, bytes('id="fallback"')), type(uint256).max, "no fallback either");
    }

    function test_painted_art_is_fixed_at_deploy() public view {
        assertEq(address(qc.ART()), address(art));
        assertEq(art.chunks().length, 15);
    }

    /// 4 Nov v1.2 with a made-up first shot on its Epic spot 7: every skin of the page on one night
    function test_caught_nets_show_the_painted_hamster_in_their_skin() public {
        uint8[6] memory spots = [uint8(1), 3, 11, 7, 15, 13];
        uint8[6] memory tiers = [uint8(1), 2, 3, 5, 1, 1]; // Common body, Uncommon tiger, Rare circuit, Legendary gold
        uint256[6] memory ids;
        for (uint256 k; k < 6; ++k) {
            ids[k] = _cast(address(uint160(0xB000 + k)), spots[k]);
        }
        vm.warp(OVER_1104);
        _postF(N1104, _counts1104v12(), TURNS_1104, STEPS_1104_V12, 7);
        for (uint256 k; k < 6; ++k) {
            (uint8 status,,,,, uint8 tier,) = qc.result(ids[k]);
            assertEq(status, 1);
            assertEq(tier, tiers[k], vm.toString(spots[k]));
            _assertPainted(ids[k], spots[k], tiers[k]);
        }
        // the next night, the real first shot (spot 3): spot 7 is Epic (crystal)
        uint32 n = N1104 + 1;
        vm.warp(qc.nightStart(n) + 60);
        uint256 epic = _cast(alice, 7);
        vm.warp(qc.nightOverAt(n));
        _postF(n, _counts1104v12(), TURNS_1104, STEPS_1104_V12, FIRST_1104_V12);
        (,,,,, uint8 t,) = qc.result(epic);
        assertEq(t, 4);
        _assertPainted(epic, 7, 4);
    }

    function test_no_painted_hamster_unless_caught() public {
        uint256 waiting = _cast(alice, 15);
        uint256 out = _cast(bob, 0); // 4 Nov v1.2: out of reach (40 landings = 1 %: chip noise)
        _assertNotPainted(waiting);
        vm.warp(OVER_1104);
        _postF(N1104, _counts1104v12(), TURNS_1104, STEPS_1104_V12, FIRST_1104_V12);
        bytes memory s = _assertNotPainted(out);
        assertTrue(_find(s, bytes('id="outofreach"')) != type(uint256).max);

        vm.warp(qc.nightStart(N1104 + 1) + 60);
        uint256 slept = _cast(alice, 5);
        vm.warp(qc.nightOverAt(N1104 + 1));
        uint16[16] memory zero;
        _postF(N1104 + 1, zero, 0, 0, 0);
        s = _assertNotPainted(slept);
        assertTrue(_find(s, bytes("HE SLEPT")) != type(uint256).max);
        assertTrue(_find(s, bytes('<g id="hamster">')) != type(uint256).max, "the drawn hamster, asleep");

        vm.warp(qc.nightStart(N1104 + 2) + 60);
        uint256 lost = _cast(bob, 5);
        vm.warp(qc.postDeadline(N1104 + 2));
        s = _assertNotPainted(lost);
        assertTrue(_find(s, bytes("NO CHIP RESULT")) != type(uint256).max);
    }

    function test_art_that_reverts_falls_back_to_the_drawn_hamster() public {
        QuantumCatch q2 = new QuantumCatch(hatcher, IPaintedArt(address(new RevertingArt())));
        vm.prank(alice);
        uint256 id = q2.castNet(15);
        vm.warp(OVER_1104);
        vm.prank(hatcher);
        q2.postNight(N1104, _counts1104(), TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, FIRST_1104);
        string memory uri = q2.tokenURI(id);
        bytes memory svg = _svgOfUri(uri);
        assertTrue(_find(svg, bytes('<g id="hamster">')) != type(uint256).max, "the drawn hamster");
        assertEq(_find(svg, bytes('id="painted"')), type(uint256).max);
        assertEq(_find(svg, bytes('id="fallback"')), type(uint256).max, "full size: no fallback group without art");
        string memory j = string(_b64(T.after_(uri, bytes(JSON_PREFIX).length)));
        assertEq(vm.parseJsonString(j, ".attributes[3].value"), "Common");
    }

    /// the heaviest fragment (looks 15: hat, glasses, scarf, grin, in the circuit skin = Rare; 99,541 bytes) through
    /// the real path: a night where spot 15 is Rare. The eth_call a wallet makes must stay under 30M gas.
    function test_gas_the_heaviest_tokenURI() public {
        uint256 id = _cast(alice, 15);
        uint256 light = _cast(bob, 1);
        vm.warp(OVER_1104);
        uint16[16] memory c = _counts1104v12();
        (c[11], c[15]) = (c[15], c[11]); // 15 gets 260: rank 7 of 8 = Rare; 11 gets 525
        _postF(N1104, c, TURNS_1104, STEPS_1104_V12, FIRST_1104_V12);
        (,,,,, uint8 tier,) = qc.result(id);
        assertEq(tier, 3);
        uint256 g = gasleft();
        string memory uri = qc.tokenURI(id);
        g -= gasleft();
        console2.log("tokenURI caught, looks 15, Rare (the heaviest): gas", g);
        console2.log("tokenURI length (bytes)", bytes(uri).length);
        assertLt(g, ETH_CALL_CAP / 2, "far under a 30M eth_call");
        assertEq(bytes(art.hamster(15, 3)).length, 99541);
        g = gasleft();
        uri = qc.tokenURI(light);
        g -= gasleft();
        console2.log("tokenURI caught, looks 1, Common: gas", g);
        console2.log("tokenURI length (bytes)", bytes(uri).length);
    }

    /// one looks x tier through the renderer (what tokenURI does after _card), in its own call frame
    function measure(uint8 looks, uint8 tier) external view returns (uint256 gasUsed, uint256 length) {
        CatchArt.Card memory c;
        c.status = 1;
        c.night = N1104;
        c.spot = looks;
        c.tier = tier;
        c.shots = 4000;
        c.hits = 300;
        c.reach = 1;
        c.steps = 10;
        c.start = 9;
        c.rank = 4;
        c.catchable = 8;
        c.jobId = JOB_1104;
        c.sha = SHA_1104;
        CatchArt r = qc.RENDERER();
        uint256 g = gasleft();
        string memory uri = r.tokenURI(c, art.hamster(looks, tier));
        gasUsed = g - gasleft();
        length = bytes(uri).length;
    }

    /// every looks x tier: the painted hamster + the renderer stay far under a 30M eth_call, the heaviest is looks 15
    /// in the circuit skin (Rare)
    function test_gas_every_looks_and_tier() public view {
        uint256 most;
        uint256 mostAt;
        uint256 longest;
        uint256 least = type(uint256).max;
        for (uint8 looks; looks < 16; ++looks) {
            for (uint8 tier = 1; tier <= 5; ++tier) {
                (uint256 g, uint256 len) = this.measure(looks, tier);
                if (g > most) (most, mostAt) = (g, uint256(looks) * 10 + tier);
                if (g < least) least = g;
                if (len > longest) longest = len;
            }
        }
        console2.log("hamster + render, the most gas over 16 looks x 5 tiers", most);
        console2.log("  at looks * 10 + tier", mostAt);
        console2.log("  the least", least);
        console2.log("  longest tokenURI (bytes)", longest);
        assertEq(mostAt, 153, "looks 15, Rare is the heaviest");
        assertLt(most, ETH_CALL_CAP / 2);
    }
}
