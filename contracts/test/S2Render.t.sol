// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V3Base} from "./V3Base.t.sol";
import {S2Art} from "./S2Art.sol";
import {QuantumCatchV3, ISqk} from "../src/QuantumCatchV3.sol";
import {Card, Dna} from "../src/S2Types.sol";
import {S2Renderer} from "../src/S2Renderer.sol";
import {S2Text} from "../src/S2Text.sol";
import {S2Directory} from "../src/S2Directory.sol";

/// Season 2 with the real packed art: the chain's output equals the reference (tools/s2_ref.py) byte for byte
/// (test/data/s2-vectors.json, made by tools/pack_s2.py).
abstract contract S2ArtBase is V3Base, S2Art {
    S2Renderer internal art;
    string internal vec;
    address internal directory;
    address[] internal chunkList;
    uint256 internal caster0;

    function setUp() public virtual override {
        super.setUp();
        (directory, chunkList) = _deployS2Art();
        art = new S2Renderer(directory, chunkList, new S2Text());
        qc = new QuantumCatchV3(hatcher, art, ISqk(address(0)), 0);
        vec = vm.readFile("test/data/s2-vectors.json");
        caster0 = vm.parseJsonUint(vec, ".caster0");
    }

    /// night `key` of the vectors: its index there
    function _night(string memory key) internal view returns (uint256 i) {
        for (; i < 8; ++i) {
            if (keccak256(bytes(vm.parseJsonString(vec, string.concat(".nights[", vm.toString(i), "].key")))) == keccak256(bytes(key))) {
                return i;
            }
        }
        revert(string.concat("no night ", key));
    }

    struct NightV {
        uint32 n;
        uint16[16] counts;
        uint32 turns;
        uint8 steps;
        uint8 first;
        bytes32 job;
        bytes32 sha;
        bytes32 nightSeed;
    }

    function _nightV(uint256 i) internal view returns (NightV memory v) {
        string memory p = string.concat(".nights[", vm.toString(i), "]");
        v.n = uint32(vm.parseJsonUint(vec, string.concat(p, ".n")));
        uint256[] memory c = vm.parseJsonUintArray(vec, string.concat(p, ".counts"));
        for (uint256 s; s < 16; ++s) {
            v.counts[s] = uint16(c[s]);
        }
        v.turns = uint32(vm.parseJsonUint(vec, string.concat(p, ".turns")));
        v.steps = uint8(vm.parseJsonUint(vec, string.concat(p, ".steps")));
        v.first = uint8(vm.parseJsonUint(vec, string.concat(p, ".first")));
        v.job = vm.parseJsonBytes32(vec, string.concat(p, ".jobKeccak"));
        v.sha = vm.parseJsonBytes32(vec, string.concat(p, ".sha256"));
        v.nightSeed = vm.parseJsonBytes32(vec, string.concat(p, ".sealKeccak"));
    }

    function _caster(uint256 i) internal view returns (address) {
        return address(uint160(caster0 + i));
    }

    /// base64 decoding in assembly (the cards are up to ~235 KB)
    function _b64(bytes memory src, uint256 from) internal pure returns (bytes memory out) {
        uint256 n = src.length - from;
        require(n % 4 == 0, "b64 length");
        uint256 pad = n == 0 ? 0 : (src[src.length - 1] == "=" ? 1 : 0) + (n > 1 && src[src.length - 2] == "=" ? 1 : 0);
        bytes memory rev = new bytes(256);
        bytes memory tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (uint256 i; i < 64; ++i) {
            rev[uint8(tbl[i])] = bytes1(uint8(i));
        }
        out = new bytes((n / 4) * 3 + 32);
        assembly ("memory-safe") {
            let r := add(rev, 0x20)
            let p := add(add(src, 0x20), from)
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

    /// data URI -> its JSON -> its SVG: each layer decodes and parses
    function _decode(string memory uri) internal view returns (string memory j, bytes memory svg) {
        bytes memory u = bytes(uri);
        assertEq(_prefix(u, "data:application/json;base64,"), true, "json data uri");
        j = string(_b64(u, 29));
        string memory img = vm.parseJsonString(j, ".image");
        assertEq(_prefix(bytes(img), "data:image/svg+xml;base64,"), true, "svg data uri");
        svg = _b64(bytes(img), 26);
        assertTrue(_prefix(svg, "<svg "), "an svg");
        assertTrue(_suffix(svg, "</svg>"), "a whole svg");
    }

    function _prefix(bytes memory b, bytes memory p) internal pure returns (bool) {
        if (b.length < p.length) return false;
        for (uint256 i; i < p.length; ++i) {
            if (b[i] != p[i]) return false;
        }
        return true;
    }

    function _suffix(bytes memory b, bytes memory p) internal pure returns (bool) {
        if (b.length < p.length) return false;
        for (uint256 i; i < p.length; ++i) {
            if (b[b.length - p.length + i] != p[i]) return false;
        }
        return true;
    }

    function _worst() internal view returns (Card memory c, Dna memory d) {
        string memory p = ".worst.card";
        c.status = uint8(vm.parseJsonUint(vec, string.concat(p, ".status")));
        c.night = uint32(vm.parseJsonUint(vec, string.concat(p, ".night")));
        c.spot = uint8(vm.parseJsonUint(vec, string.concat(p, ".spot")));
        c.hits = uint16(vm.parseJsonUint(vec, string.concat(p, ".hits")));
        c.shots = uint32(vm.parseJsonUint(vec, string.concat(p, ".shots")));
        c.tier = uint8(vm.parseJsonUint(vec, string.concat(p, ".tier")));
        c.reach = uint8(vm.parseJsonUint(vec, string.concat(p, ".reach")));
        c.steps = uint8(vm.parseJsonUint(vec, string.concat(p, ".steps")));
        c.start = uint8(vm.parseJsonUint(vec, string.concat(p, ".start")));
        c.firstShot = uint8(vm.parseJsonUint(vec, string.concat(p, ".firstShot")));
        c.rank = uint8(vm.parseJsonUint(vec, string.concat(p, ".rank")));
        c.catchable = uint8(vm.parseJsonUint(vec, string.concat(p, ".catchable")));
        uint256[] memory cs = vm.parseJsonUintArray(vec, string.concat(p, ".counts"));
        for (uint256 s; s < 16; ++s) {
            c.counts |= cs[s] << (16 * s);
        }
        c.jobId = vm.parseJsonBytes32(vec, string.concat(p, ".jobKeccak"));
        c.sha = vm.parseJsonBytes32(vec, string.concat(p, ".sha256"));
        c.seedBlock = uint64(vm.parseJsonUint(vec, string.concat(p, ".seedBlock")));
        c.seed = vm.parseJsonBytes32(vec, string.concat(p, ".sealKeccak"));
        d = _dnaAt(".worst.dna");
    }

    function _dnaAt(string memory p) internal view returns (Dna memory d) {
        d.status = uint8(vm.parseJsonUint(vec, string.concat(p, ".status")));
        d.tier = uint8(vm.parseJsonUint(vec, string.concat(p, ".tier")));
        d.spot = uint8(vm.parseJsonUint(vec, string.concat(p, ".spot")));
        d.shots = uint32(vm.parseJsonUint(vec, string.concat(p, ".shots")));
        d.word = vm.parseJsonBytes32(vec, string.concat(p, ".wordKeccak"));
        uint256[] memory t = vm.parseJsonUintArray(vec, string.concat(p, ".tiers"));
        uint256[] memory s = vm.parseJsonUintArray(vec, string.concat(p, ".spots"));
        uint256[] memory l = vm.parseJsonUintArray(vec, string.concat(p, ".landings"));
        bytes32[] memory w = vm.parseJsonBytes32Array(vec, string.concat(p, ".slotKeccaks"));
        for (uint256 k; k < 10; ++k) {
            d.tiers[k] = uint8(t[k]);
            d.spots[k] = uint8(s[k]);
            d.landings[k] = uint32(l[k]);
            d.words[k] = w[k];
        }
    }
}

contract S2RenderVectorsTest is S2ArtBase {
    /// the raw DNA (dnaFor) and the looks (looksOf) of every simulated caster: 2,000 on the v1.2 night of 4 Nov, 400
    /// on its golden variant, 200 on a golden 1 Nov, 100 on the v1 4 Nov night (2,700)
    function test_dna_and_looks_2000_on_the_v12_night() public view {
        assertEq(_simNight(0), 2000);
    }

    function test_dna_and_looks_400_on_its_golden_variant() public view {
        assertEq(_simNight(1), 400);
    }

    function test_dna_and_looks_200_on_a_golden_1_nov() public view {
        assertEq(_simNight(2), 200);
    }

    function test_dna_and_looks_100_on_a_v1_night() public view {
        assertEq(_simNight(3), 100);
    }

    function _simNight(uint256 ni) internal view returns (uint256) {
        bytes32 bh = vm.parseJsonBytes32(vec, ".sealBlockKeccak");
        NightV memory v = _nightV(ni);
        assertEq(v.nightSeed, keccak256(abi.encode(bh, v.sha, v.job)), "the seed of a night sealed with that block");
        string memory p = string.concat(".nights[", vm.toString(ni), "]");
        bytes32[] memory dk = vm.parseJsonBytes32Array(vec, string.concat(p, ".dnaKeccaks"));
        bytes32[] memory lk = vm.parseJsonBytes32Array(vec, string.concat(p, ".looksKeccaks"));
        uint256 c0 = vm.parseJsonUint(vec, ".caster0");
        for (uint256 i; i < dk.length; ++i) {
            this.checkSim(v, _id(v.n, address(uint160(c0 + i))), dk[i], lk[i]); // its own frame: memory freed
        }
        return dk.length;
    }

    function checkSim(NightV calldata v, uint256 id, bytes32 dk, bytes32 lk) external view {
        Dna memory d = qc.dnaFor(v.n, v.nightSeed, id, v.counts, v.turns, v.steps, v.first);
        assertEq(keccak256(abi.encode(d)), dk, "dnaFor = the reference");
        (uint8 skin, uint8[10] memory items, uint8[10] memory tiers) = art.looksOf(d);
        assertEq(keccak256(abi.encode(skin, items, tiers)), lk, "looksOf = the reference");
        (uint8 skin2, uint8[10] memory items2) = art.itemsOf(d);
        assertEq(keccak256(abi.encode(skin2, items2)), keccak256(abi.encode(skin, items)));
    }

    function checkUri(QuantumCatchV3 g, uint256 id, uint256 len, bytes32 sha, uint256 c) external view {
        bytes memory u = bytes(g.tokenURI(id));
        assertEq(u.length, len, string.concat("length of case ", vm.toString(c)));
        assertEq(sha256(u), sha, string.concat("bytes of case ", vm.toString(c)));
    }

    /// tokenURI through the game (cast, post, seal) equals the reference byte for byte: the nets that together show
    /// every stored element at least once (on the golden variant of the v1.2 4 Nov night and on the night itself), 120
    /// sampled sims and a net that got away; the 4 undrawn states: test_states
    function test_tokenURI_byte_for_byte_golden_night() public {
        assertGt(_uriNight("r0hkb-golden"), 50);
    }

    function test_tokenURI_byte_for_byte_v12_night() public {
        assertGt(_uriNight("r0hkb"), 140);
    }

    function _uriNight(string memory key) internal returns (uint256 checked) {
        string[] memory nights = vm.parseJsonStringArray(vec, ".uri.night");
        uint256[] memory is_ = vm.parseJsonUintArray(vec, ".uri.i");
        string[] memory why = vm.parseJsonStringArray(vec, ".uri.why");
        bytes32[] memory sha = vm.parseJsonBytes32Array(vec, ".uri.sha256s");
        uint256[] memory len = vm.parseJsonUintArray(vec, ".uri.length");
        NightV memory v = _nightV(_night(key));
        QuantumCatchV3 g = new QuantumCatchV3(hatcher, art, ISqk(address(0)), 0);
        vm.warp(g.nightStart(v.n) + 3600);
        for (uint256 c; c < nights.length; ++c) {
            if (!_is(nights[c], key) || !_drawn(why[c])) continue;
            vm.prank(_caster(is_[c]));
            g.castNet();
        }
        vm.warp(g.nightOverAt(v.n));
        vm.roll(POST_BLOCK);
        vm.prank(hatcher);
        g.postNight(v.n, v.counts, v.turns, v.steps, v.job, v.sha, v.first);
        vm.roll(POST_BLOCK + 2);
        vm.setBlockhash(POST_BLOCK + 1, vm.parseJsonBytes32(vec, ".sealBlockKeccak"));
        assertEq(g.seal(v.n), v.nightSeed);
        for (uint256 c; c < nights.length; ++c) {
            if (!_is(nights[c], key) || !_drawn(why[c])) continue;
            this.checkUri(g, _id(v.n, _caster(is_[c])), len[c], sha[c], c);
            ++checked;
        }
    }

    /// waiting, drawing, he slept, no chip result: the reference's bytes too
    function test_states_equal_the_reference() public {
        string[] memory why = vm.parseJsonStringArray(vec, ".uri.why");
        bytes32[] memory sha = vm.parseJsonBytes32Array(vec, ".uri.sha256s");
        NightV memory v = _nightV(_night("r0hkb"));
        address who = _caster(0);
        // waiting (posted nothing yet), then no chip result (the window passed)
        QuantumCatchV3 g = new QuantumCatchV3(hatcher, art, ISqk(address(0)), 0);
        vm.warp(g.nightStart(v.n) + 3600);
        vm.prank(who);
        uint256 id = g.castNet();
        assertEq(sha256(bytes(g.tokenURI(id))), sha[_case(why, "waiting")], "waiting");
        _decode(g.tokenURI(id));
        vm.warp(g.postDeadline(v.n));
        assertEq(sha256(bytes(g.tokenURI(id))), sha[_case(why, "no result")], "no chip result");
        // drawing: posted, not sealed
        g = new QuantumCatchV3(hatcher, art, ISqk(address(0)), 0);
        vm.warp(g.nightStart(v.n) + 3600);
        vm.prank(who);
        g.castNet();
        vm.warp(g.nightOverAt(v.n));
        vm.roll(POST_BLOCK);
        vm.prank(hatcher);
        g.postNight(v.n, v.counts, v.turns, v.steps, v.job, v.sha, v.first);
        assertEq(sha256(bytes(g.tokenURI(id))), sha[_case(why, "drawing")], "drawing");
        _decode(g.tokenURI(id));
        // he slept
        g = new QuantumCatchV3(hatcher, art, ISqk(address(0)), 0);
        vm.warp(g.nightStart(v.n) + 3600);
        vm.prank(who);
        g.castNet();
        vm.warp(g.nightOverAt(v.n));
        uint16[16] memory none;
        vm.prank(hatcher);
        g.postNight(v.n, none, 0, 0, v.job, v.sha, 0);
        assertEq(sha256(bytes(g.tokenURI(id))), sha[_case(why, "slept")], "slept");
        _decode(g.tokenURI(id));
    }

    function _is(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _drawn(string memory why) internal pure returns (bool) {
        return _is(why, "coverage") || _is(why, "sim") || _is(why, "got away");
    }

    function _case(string[] memory why, string memory w) internal pure returns (uint256) {
        for (uint256 i; i < why.length; ++i) {
            if (_is(why[i], w)) return i;
        }
        revert(w);
    }
}

contract S2RenderWorstTest is S2ArtBase {
    /// the heaviest card this art can make (the heaviest element in every slot): byte for byte, decodes, and renders
    /// cold in one eth_call well under the lowest measured read-call cap (16,762,214 gas)
    function test_worst_card_renders_cold_under_8M_gas() public {
        (Card memory c, Dna memory d) = _worst();
        bytes memory call_ = abi.encodeCall(S2Renderer.tokenURI, (c, d));
        uint256 g0 = gasleft();
        (bool ok, bytes memory ret) = address(art).staticcall{gas: 16_762_214}(call_);
        uint256 used = g0 - gasleft();
        assertTrue(ok, "renders inside the read-call cap");
        string memory uri = abi.decode(ret, (string));
        emit log_named_uint("worst card: tokenURI bytes", bytes(uri).length);
        emit log_named_uint("worst card: gas (cold, with the call)", used);
        assertLe(used, 8_000_000, "<= 8M gas");
        assertEq(bytes(uri).length, vm.parseJsonUint(vec, ".worst.length"));
        assertEq(sha256(bytes(uri)), vm.parseJsonBytes32(vec, ".worst.uriSha256"), "the reference's bytes");
        (string memory j, bytes memory svg) = _decode(uri);
        assertGt(svg.length, 100_000);
        assertEq(vm.parseJsonString(j, ".attributes[4].trait_type"), "Skin");
    }

    /// a typical card's gas, through the game (cast, post, seal, tokenURI)
    function test_typical_card_gas() public {
        uint16[16] memory c = _counts1104v12();
        uint256 id = _castOn(13, c);
        _post1104(c, FIRST_1104_V12);
        uint256 g0 = gasleft();
        string memory uri = qc.tokenURI(id);
        emit log_named_uint("typical card (spot 13, Common): gas through the game", g0 - gasleft());
        emit log_named_uint("typical card: tokenURI bytes", bytes(uri).length);
        _decode(uri);
    }
}

contract S2RenderDeployTest is S2ArtBase {
    function test_constructor_accepts_only_the_packed_art_in_order() public {
        S2Text t = new S2Text();
        vm.expectRevert(abi.encodeWithSelector(S2Renderer.WrongDirectory.selector, address(t)));
        new S2Renderer(address(t), chunkList, t);
        address[] memory short = new address[](chunkList.length - 1);
        for (uint256 i; i < short.length; ++i) {
            short[i] = chunkList[i];
        }
        vm.expectRevert(abi.encodeWithSelector(S2Renderer.WrongChunkCount.selector, short.length));
        new S2Renderer(directory, short, t);
        address[] memory swapped = chunkList;
        (swapped[3], swapped[4]) = (swapped[4], swapped[3]);
        vm.expectRevert(abi.encodeWithSelector(S2Renderer.WrongChunk.selector, 3, swapped[3]));
        new S2Renderer(directory, swapped, t);
        (swapped[3], swapped[4]) = (swapped[4], swapped[3]);
        vm.expectRevert(abi.encodeWithSelector(S2Renderer.TextHasNoCode.selector, alice));
        new S2Renderer(directory, swapped, S2Text(alice));
        S2Renderer ok = new S2Renderer(directory, swapped, t);
        assertEq(ok.chunks().length, chunkList.length);
        assertEq(ok.DIRECTORY(), directory);
        assertEq(directory.codehash, ok.DIRECTORY_CODEHASH());
    }

    /// EIP-170 (runtime < 24,576) and EIP-3860 (initcode < 49,152) for every contract of the deploy
    function test_sizes() public {
        assertLt(address(qc).code.length, 24_576, "QuantumCatchV3 runtime");
        assertLt(address(art).code.length, 24_576, "S2Renderer runtime");
        assertLt(address(art.TEXT()).code.length, 24_576, "S2Text runtime");
        assertLe(directory.code.length, 24_576, "S2Directory runtime");
        for (uint256 k; k < chunkList.length; ++k) {
            assertLe(chunkList[k].code.length, 24_576, "chunk runtime");
        }
        assertLt(type(QuantumCatchV3).creationCode.length, 49_152);
        assertLt(type(S2Renderer).creationCode.length, 49_152);
        assertLt(type(S2Text).creationCode.length, 49_152);
        assertLt(type(S2Directory).creationCode.length, 49_152);
        assertLt(vm.getCode("S2Art000.sol:S2Art000").length, 49_152);
        emit log_named_uint("QuantumCatchV3 runtime", address(qc).code.length);
        emit log_named_uint("S2Renderer runtime", address(art).code.length);
        emit log_named_uint("S2Text runtime", address(art.TEXT()).code.length);
        emit log_named_uint("S2Directory runtime", directory.code.length);
        emit log_named_uint("art chunks", chunkList.length);
    }

    function test_names_and_tables() public view {
        assertEq(art.traitName(1, 0), "Honey");
        assertEq(art.traitName(2, 0), "None");
        assertEq(art.traitName(2, 1), "Party hat");
        assertEq(art.traitName(2, 14), "Sprout");
        assertEq(art.traitTier(2, 14), 3, "sprout is Rare (the odds rule with half-crazy)");
        assertEq(art.traitName(2, 19), "Halo");
        assertEq(art.traitName(8, 1), unicode"Schrödinger box");
        assertEq(art.traitTier(8, 1), 4);
        assertEq(art.traitName(8, 3), "Caught in a glowing net");
        assertEq(art.traitTier(8, 3), 5);
        assertEq(art.traitName(7, 3), "Jetpack");
        assertEq(art.traitName(10, 9), "Treasury");
        assertEq(art.traitTier(10, 9), 5);
        assertEq(art.skinName(0), "Plain");
        assertEq(art.skinName(10), "Rainbow");
        assertTrue(art.facePainted(0, 8), "plain has every face");
        assertTrue(art.facePainted(1, 2), "tiger wink (7 Nov)");
        assertTrue(art.facePainted(10, 0), "rainbow honey");
        assertFalse(art.facePainted(10, 1), "no rainbow grin (paint group 7)");
        assertFalse(art.facePainted(1, 8), "no tiger stuffed (paint group 7)");
        assertFalse(art.facePainted(9, 7), "gold derpy is never drawn (no Epic face on a golden night)");
        uint8[4][10] memory want = [
            [3, 2, 2, 1], [9, 5, 5, 1], [4, 2, 2, 1], [2, 2, 2, 1], [2, 2, 2, 1], [2, 2, 2, 1], [2, 2, 3, 1],
            [0, 0, 2, 1], [0, 2, 3, 1], [4, 2, 2, 1]
        ];
        for (uint8 k = 1; k <= 10; ++k) {
            (uint8 u, uint8 r, uint8 e, uint8 l) = art.listLengths(k);
            assertEq(abi.encode(u, r, e, l), abi.encode(want[k - 1][0], want[k - 1][1], want[k - 1][2], want[k - 1][3]));
        }
        assertTrue(art.HALF_CRAZY());
    }
}

/// the looks rule on hand-made draws (precedence, half-crazy, empty lists)
contract S2LooksTest is S2ArtBase {
    function _caught(uint8 tier) internal pure returns (Dna memory d) {
        d.status = 1;
        d.tier = tier;
        d.shots = 4000;
    }

    /// a word whose item index (w / shots) % n is `idx`, with the top bit `top`
    function _w(uint256 idx, uint256 n, bool top) internal pure returns (bytes32) {
        uint256 hi = top ? 1 << 255 : 0;
        uint256 m = (idx + n * 1000 - ((hi / 4000) % n)) % n; // (hi + m * 4000) / 4000 = hi / 4000 + m
        return bytes32(hi + m * 4000);
    }

    function test_common_and_noise_leave_the_slot_plain() public view {
        Dna memory d = _caught(2);
        for (uint256 k; k < 10; ++k) {
            d.tiers[k] = k % 2 == 0 ? 0 : 1;
            d.words[k] = bytes32(type(uint256).max);
        }
        (, uint8[10] memory items) = art.itemsOf(d);
        for (uint256 k; k < 10; ++k) {
            assertEq(items[k], 0);
        }
    }

    function test_half_crazy_epic_shows_rare_when_the_top_bit_is_0() public view {
        Dna memory d = _caught(2);
        d.tiers[1] = 4; // Head, Epic shot (5 Epic heads, 5 Rare heads)
        d.words[1] = _w(0, 5, true);
        (, uint8[10] memory items, uint8[10] memory tiers) = art.looksOf(d);
        assertEq(tiers[1], 4, "top bit 1: the Epic list");
        assertEq(items[1], 9 + 5 + 1, "the first Epic head (wizard)");
        d.words[1] = _w(0, 5, false);
        (, items, tiers) = art.looksOf(d);
        assertEq(tiers[1], 3, "top bit 0: the Rare list");
        assertEq(items[1], 9 + 1, "the first Rare head (headphones)");
        // Special has no Rare list: an Epic shot with top bit 0 shows nothing
        d.tiers[7] = 4;
        d.words[7] = _w(0, 2, false);
        (, items,) = art.looksOf(d);
        assertEq(items[7], 0);
    }

    /// (every launch slot has its own Legendary list now: the Epic fallback for an empty one is in the reference and
    /// the contract, unused by these lists)
    function test_legendary_shows_its_own_list() public view {
        Dna memory d = _caught(2);
        d.tiers[2] = 5; // Eyes: the gold visor
        d.words[2] = _w(0, 1, false);
        (, uint8[10] memory items, uint8[10] memory tiers) = art.looksOf(d);
        assertEq(tiers[2], 5);
        assertEq(items[2], 4 + 2 + 2 + 1, "the gold visor");
    }

    function test_box_keeps_on_a_tie_and_goes_on_a_loss() public view {
        Dna memory d = _caught(2);
        d.tiers[7] = 4; // the box (Epic, top bit 1, the first of 2)
        d.words[7] = _w(0, 2, true);
        d.tiers[4] = 4; // Neck: gold chain (Epic)
        d.words[4] = _w(0, 2, true);
        d.tiers[5] = 2; // Hands: cheese
        d.words[5] = _w(0, 2, false);
        (, uint8[10] memory items,) = art.looksOf(d);
        assertEq(items[7], 1, "a tie keeps the box");
        assertEq(items[4], 0);
        assertEq(items[5], 0);
        d.tiers[4] = 5; // Neck Legendary: the gold medal outranks the box
        d.words[4] = _w(0, 1, false);
        (, items,) = art.looksOf(d);
        assertEq(items[7], 0, "the box goes");
        assertEq(items[4], 7, "the gold medal shows");
        assertEq(items[5], 1, "and the cheese");
        // the box drawn Epic with top bit 0: Special has no Rare list -> no box, neck and hands stay
        d.tiers[4] = 4;
        d.words[4] = _w(0, 2, true);
        d.words[7] = _w(0, 2, false);
        (, items,) = art.looksOf(d);
        assertEq(items[7], 0);
        assertEq(items[4], 5);
        assertEq(items[5], 1);
    }

    function test_box_hides_a_lower_hands_item_and_the_net_hides_nothing() public view {
        Dna memory d = _caught(2);
        d.tiers[7] = 4; // the box
        d.words[7] = _w(0, 2, true);
        d.tiers[5] = 3; // Hands: coin (Rare)
        d.words[5] = _w(0, 2, false);
        (, uint8[10] memory items,) = art.looksOf(d);
        assertEq(items[7], 1);
        assertEq(items[5], 0, "hidden in the box");
        d.tiers[7] = 5; // Special Legendary: caught in a glowing net (no hiding rule)
        d.words[7] = _w(0, 1, false);
        (, items,) = art.looksOf(d);
        assertEq(items[7], 3);
        assertEq(items[5], 3, "the coin shows");
        d.tiers[7] = 4; // the glass pod (the second Epic special): no hiding rule either
        d.words[7] = _w(1, 2, true);
        (, items,) = art.looksOf(d);
        assertEq(items[7], 2);
        assertEq(items[5], 3);
    }

    function test_no_helmet_on_stuffed_cheeks() public view {
        Dna memory d = _caught(1); // plain skin: every face painted
        d.tiers[0] = 5; // Face: stuffed (Legendary)
        d.words[0] = _w(0, 1, false);
        d.tiers[1] = 4; // Head: astronaut is the 3rd of 5 Epic heads
        d.words[1] = _w(2, 5, true);
        (, uint8[10] memory items,) = art.looksOf(d);
        assertEq(items[0], 8, "stuffed");
        assertEq(items[1], 0, "no astronaut helmet");
        d.tiers[0] = 2; // a grin: the helmet stays
        (, items,) = art.looksOf(d);
        assertEq(items[1], 9 + 5 + 3);
    }

    function test_unpainted_face_shows_honey() public view {
        Dna memory d = _caught(5); // gold or rainbow
        d.word = bytes32(uint256(1) * 4000); // (w0 / shots) % 2 = 1: rainbow
        d.tiers[0] = 2; // grin
        d.words[0] = _w(0, 3, false);
        (uint8 skin, uint8[10] memory items) = art.itemsOf(d);
        assertEq(skin, 10, "rainbow");
        assertEq(items[0], 0, "rainbow has only honey so far");
        d.word = bytes32(0); // gold
        (skin, items) = art.itemsOf(d);
        assertEq(skin, 9);
        assertEq(items[0], 1, "gold grin is painted");
    }
}

/// tokenURI never reverts for anything the game can hand it
contract S2RenderFuzzTest is S2ArtBase {
    /// forge-config: default.fuzz.runs = 48
    function testFuzz_caught_card_never_reverts(
        uint8 tier,
        uint32 shots,
        bytes32 w0,
        uint8[10] memory tiers,
        bytes32 salt,
        uint8 spot
    ) public view {
        Card memory c;
        Dna memory d;
        c.status = d.status = 1;
        c.tier = d.tier = uint8(bound(tier, 1, 5));
        c.shots = d.shots = uint32(bound(shots, 1, 16 * 65535));
        c.spot = d.spot = uint8(bound(spot, 0, 15));
        c.hits = 1;
        c.counts = uint256(salt);
        c.reach = 1;
        c.steps = 10;
        c.night = 20761;
        d.word = w0;
        for (uint256 k; k < 10; ++k) {
            d.tiers[k] = uint8(bound(tiers[k], 0, 5));
            d.words[k] = keccak256(abi.encode(salt, k));
            d.landings[k] = uint32(uint256(d.words[k]) % d.shots);
            d.spots[k] = uint8(uint256(d.words[k]) % 16);
        }
        string memory uri = art.tokenURI(c, d);
        assertGt(bytes(uri).length, 1000);
    }

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_other_states_never_revert(uint8 status, uint8 spot, uint32 shots, uint8 reach, bytes32 j)
        public
        view
    {
        Card memory c;
        Dna memory d;
        c.status = d.status = uint8(bound(status, 0, 5));
        if (c.status == 1) c.status = d.status = 2;
        c.night = 20761;
        c.spot = c.status == 2 ? uint8(bound(spot, 0, 15)) : 255;
        c.shots = c.status == 2 || c.status == 5 ? uint32(bound(shots, 1, 16 * 65535)) : 0;
        c.reach = c.status == 2 ? uint8(bound(reach, 1, 2)) : 0;
        c.jobId = j;
        string memory uri = art.tokenURI(c, d);
        _decode(uri);
    }
}
