// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// A stand-in Season 2 renderer for the PAGE tests (wheel/test/page.test.cjs): the real QuantumCatchV3 on a local anvil
/// chain calls it exactly as it calls S2Renderer (tokenURI(Card, Dna) returned as is, itemsOf(Dna)), without the ~70 art
/// data contracts. Its card is small and easy to recognise: a tier-coloured 320x320 SVG with a round "hamster" in the
/// painted box (70.4, 14.4, 179.2 x 240, as S2Renderer) and the words "S2 TEST", the net's spot, tier and its first slot
/// word, as on-chain base64 JSON (the real format). Skin names by tier: Plain, Tiger, Circuit, Galaxy, Rainbow.
/// The structs copy S2Types.sol field for field (the ABI selector depends on the types only). Never deployed anywhere real.
contract MockS2Renderer {
    struct Card {
        uint8 status;
        uint32 night;
        uint8 spot;
        uint16 hits;
        uint32 shots;
        uint8 tier;
        uint8 reach;
        uint8 steps;
        uint8 start;
        uint8 firstShot;
        uint8 rank;
        uint8 catchable;
        uint256 counts;
        bytes32 jobId;
        bytes32 sha;
        uint64 seedBlock;
        bytes32 seed;
    }

    struct Dna {
        uint8 status;
        uint8 tier;
        uint8 spot;
        uint32 shots;
        bytes32 word;
        uint8[10] tiers;
        uint8[10] spots;
        uint32[10] landings;
        bytes32[10] words;
    }

    string[6] internal SKIN = ["", "Plain", "Tiger", "Circuit", "Galaxy", "Rainbow"];
    string[6] internal TIER = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary"];
    string[6] internal FILL = ["#3a3f5c", "#c9a36b", "#3fbf8f", "#3f7fff", "#a35cff", "#ffc83d"];
    string[6] internal STATUS = ["waiting", "caught", "got away", "he slept", "no result", "drawing"];

    function itemsOf(Dna calldata d) external pure returns (uint8 skin, uint8[10] memory items) {
        if (d.status != 1) return (0, items);
        skin = d.tier;
        for (uint256 k; k < 10; ++k) items[k] = d.tiers[k] > 1 ? d.tiers[k] : 0;
    }

    function tokenURI(Card calldata c, Dna calldata d) external view returns (string memory) {
        bool caught = c.status == 1;
        uint8 t = caught ? c.tier : 0;
        bytes memory svg = abi.encodePacked(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'><rect width='320' height='320' fill='",
            FILL[t],
            "'/>",
            caught
                ? abi.encodePacked(
                    "<g id='painted'><rect x='70.4' y='14.4' width='179.2' height='240' fill='#0b1238'/>",
                    "<circle cx='160' cy='150' r='70' fill='#f2c894'/><circle cx='135' cy='135' r='9' fill='#26201c'/>",
                    "<circle cx='185' cy='135' r='9' fill='#26201c'/></g>"
                )
                : bytes(""),
            "<text x='160' y='292' font-size='22' text-anchor='middle' fill='#fff'>S2 TEST ",
            STATUS[c.status < 6 ? c.status : 0],
            caught ? abi.encodePacked(" #", _u(c.spot), " T", _u(t), " w", _u(uint8(uint256(d.words[0]) & 0xff))) : bytes(""),
            "</text></svg>"
        );
        bytes memory json = abi.encodePacked(
            '{"name":"Quantum Catch S2 test',
            caught ? abi.encodePacked(" ", TIER[t], " ", SKIN[t], " hamster") : bytes(""),
            '","description":"a mock card","attributes":[',
            caught
                ? abi.encodePacked('{"trait_type":"Skin","value":"', SKIN[t], '"},{"trait_type":"Head","value":"', d.tiers[1] > 1 ? "Wizard hat" : "None", '"},')
                : bytes(""),
            '{"trait_type":"Status","value":"',
            STATUS[c.status < 6 ? c.status : 0],
            '"}],"image":"data:image/svg+xml;base64,',
            _b64(svg),
            '"}'
        );
        return string(abi.encodePacked("data:application/json;base64,", _b64(json)));
    }

    function _u(uint256 v) internal pure returns (bytes memory s) {
        if (v == 0) return "0";
        while (v > 0) {
            s = abi.encodePacked(bytes1(uint8(48 + (v % 10))), s);
            v /= 10;
        }
    }

    function _b64(bytes memory data) internal pure returns (bytes memory out) {
        bytes memory T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 n = data.length;
        out = new bytes(4 * ((n + 2) / 3));
        uint256 j;
        for (uint256 i; i < n; i += 3) {
            uint256 a = uint8(data[i]);
            uint256 b = i + 1 < n ? uint8(data[i + 1]) : 0;
            uint256 c = i + 2 < n ? uint8(data[i + 2]) : 0;
            uint256 x = (a << 16) | (b << 8) | c;
            out[j++] = T[(x >> 18) & 63];
            out[j++] = T[(x >> 12) & 63];
            out[j++] = i + 1 < n ? T[(x >> 6) & 63] : bytes1("=");
            out[j++] = i + 2 < n ? T[x & 63] : bytes1("=");
        }
    }
}
