// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchLib} from "./CatchLib.sol";
import {Card, Dna} from "./S2Types.sol";

/// Quantum Catch Season 2: the words and the card frame of a net's metadata (Season 1's CatchArt texts with the seal
/// and the trait slots). Pure functions, no storage, no owner. S2Renderer calls it (a contract of its own only to keep
/// both under the EIP-170 size cap) and splices the painted hamster in between frameOpen and frameTail.
/// Every text sits inside JSON as is: no double quotes, no backslashes.
contract S2Text {
    string internal constant HEAD = "Sepolia test NFT, no value. ";
    string internal constant WHEEL =
        "A net for one night of Quantum Catch Season 2: a ticket for one of the chip's shots, nobody picks a spot. The "
        "real hamster Squeektoshi's wheel run that night (read from SqueekCore by the hatcher) programs a quantum walk on "
        "a ring of 16 spots, which runs on a real IBM quantum computer the next day. ";
    string internal constant RULES =
        "Once the night's result is posted and sealed, each net gets one of the chip's shots that night, drawn at random "
        "over all its landings (keccak256 of the night, the night's seed and the net's token id, modulo the shots, "
        "counted through the spots in order), so a spot with more landings is drawn more often. The seed is keccak256 of "
        "the hash of the block right after the post, the result file's sha256 and the IBM job id, stored by a seal "
        "transaction anyone can send: the nets close before the chip runs and that block comes after the post, so nobody, "
        "the hatcher included, can know or choose a draw (that block's hash stays readable for 8191 blocks, about 27 "
        "hours; only if nobody seals by then does a later block decide, a new one every 256 blocks). A spot is catchable tonight if it is in reach and the chip lands there in at least 1% of its "
        "shots: a net whose shot landed on a catchable spot catches that spot's hamster; otherwise the hamster got away. "
        "The tier is the spot's rank among tonight's catchable spots by landings, most first (equal landings: the lower "
        "spot number first): the last one is Epic, the one before it Rare, the two before those Uncommon, all others "
        "Common. Legendary is the Epic spot when the chip's very first shot of the night landed on it. A shot on a spot out "
        "of reach tonight never catches: he could not land there, so any landings there are the chip's own noise. A "
        "caught hamster's 10 trait slots each draw one more shot the same way (the slot number joins the hash): a shot "
        "on a Common spot or on chip noise leaves the slot plain, a rarer spot gives a rarer trait. A night he slept "
        "draws nothing. The hatcher's only power is to post each night's numbers once (the landings per spot, his "
        "turns, the steps, the spot of the first shot, the IBM job and the file's sha256), within 14 days after the "
        "night ends: it is not a player, it cannot mint, move or burn nets, and the game cannot check its numbers (check "
        "them against the result file, by its IBM job and sha256; the first shot is the first entry of its "
        "shots_in_order plus his total turns, mod 16). If nothing is posted in time, the net reads No chip result for "
        "good. Only a net's holder, or an address it approves, can burn it. ";
    string internal constant LOOKS =
        "The trait lists, names and pictures are the renderer's: the game's owner can switch renderers until it locks "
        "the game (locked() on the game), and no renderer can change a draw.";
    string internal constant OUT_NOTE = "Out of reach tonight: he could not land here; ";
    string internal constant DRAWING_NOTE =
        "The night's result is posted: its draws wait for the seal (the hash of the block after the post). ";

    string internal constant INK = "#26201c";
    string internal constant PINK = "#f2a7b5";

    /// The slots' names, in slot order (Face .. Background).
    function slotName(uint256 k) public pure returns (string memory) {
        if (k == 1) return "Face";
        if (k == 2) return "Head";
        if (k == 3) return "Eyes";
        if (k == 4) return "Mouth";
        if (k == 5) return "Neck";
        if (k == 6) return "Hands";
        if (k == 7) return "Back";
        if (k == 8) return "Special";
        if (k == 9) return "Aura";
        return "Background";
    }

    // ---------------------------------------------------------------- JSON

    /// The metadata JSON up to the image's base64 (`{"name":..,"description":..,"attributes":[..],"image":"data:image/
    /// svg+xml;base64,`), padded with spaces after its `{` to a multiple of 3 bytes (so its base64 ends on a whole
    /// group and the image's base64 can follow). A caught net names its skin and each slot's trait (`traits`, from
    /// the renderer) and counts the traits it wears (`worn`); every other net has no trait attributes.
    function head(Card calldata c, Dna calldata d, string calldata skin, string[10] calldata traits, uint256 worn)
        external
        pure
        returns (bytes memory j)
    {
        string memory date = CatchLib.dateString(c.night);
        string memory spotS = c.spot < 16 ? CatchLib.toString(c.spot) : "";
        string memory nm = c.status == 1
            ? string.concat(unicode"Quantum Catch S2 · ", tierName(c.tier), " ", skin, " hamster")
            : string.concat("Quantum Catch S2: night of ", date, c.spot < 16 ? string.concat(", spot ", spotS) : "");
        bytes memory body = abi.encodePacked(
            '"name":"',
            nm,
            '","description":"',
            _description(c, d),
            '","attributes":[',
            _attributes(c, date, spotS, skin, traits, worn),
            '],"image":"data:image/svg+xml;base64,'
        );
        uint256 pad = (3 - ((body.length + 1) % 3)) % 3;
        j = abi.encodePacked(pad == 0 ? "{" : pad == 1 ? "{ " : "{  ", body);
    }

    function _description(Card calldata c, Dna calldata d) private pure returns (bytes memory) {
        bytes memory notes = abi.encodePacked(HEAD, drawNote(c), reachNote(c), catchNote(c), dnaNote(c, d));
        if (c.status == 5) notes = abi.encodePacked(notes, DRAWING_NOTE);
        return abi.encodePacked(notes, WHEEL, reachRule(c), RULES, LOOKS);
    }

    /// Night, Spot (once drawn), Status, Tier; a caught net then its Skin, the 10 slots and Traits worn; then Landings,
    /// Shots, IBM job, Steps, Reach, Result sha256, First shot, Seal block
    function _attributes(
        Card calldata c,
        string memory date,
        string memory spotS,
        string calldata skin,
        string[10] calldata traits,
        uint256 worn
    ) private pure returns (bytes memory out) {
        out = _str("Night", date);
        if (c.spot < 16) out = abi.encodePacked(out, ",", _num("Spot", spotS));
        out = abi.encodePacked(out, ",", _str("Status", statusName(c.status)), ",", _str("Tier", tierName(c.tier)));
        if (c.status == 1) {
            out = abi.encodePacked(out, ",", _str("Skin", skin));
            for (uint256 k = 1; k <= 10; ++k) {
                out = abi.encodePacked(out, ",", _str(slotName(k), traits[k - 1]));
            }
            out = abi.encodePacked(out, ",", _num("Traits worn", CatchLib.toString(worn)));
        }
        return abi.encodePacked(out, ",", _tail(c));
    }

    function _tail(Card calldata c) private pure returns (bytes memory) {
        return abi.encodePacked(
            _num("Landings", CatchLib.toString(c.hits)),
            ",",
            _num("Shots", CatchLib.toString(c.shots)),
            ",",
            _str("IBM job", jobString(c.jobId)),
            ",",
            _num("Steps", CatchLib.toString(c.steps)),
            ",",
            _str("Reach", reachName(c)),
            ",",
            _str("Result sha256", c.sha == bytes32(0) ? "none" : hex32(c.sha)),
            ",",
            _str("First shot", c.shots == 0 ? "none" : string.concat("spot ", CatchLib.toString(c.firstShot))),
            ",",
            _str("Seal block", c.seedBlock == 0 ? "none" : CatchLib.toString(c.seedBlock))
        );
    }

    /// "Its shot landed on spot 5. " once drawn.
    function drawNote(Card calldata c) internal pure returns (string memory) {
        if (c.spot >= 16) return "";
        return string.concat("Its shot landed on spot ", CatchLib.toString(c.spot), ". ");
    }

    function reachNote(Card calldata c) internal pure returns (string memory) {
        if (c.status == 2 && c.reach == 1) return "Under 1% of the shots landed here: the hamster got away. ";
        if (c.reach != 2) return "";
        if (c.hits == 1) return string.concat(OUT_NOTE, "the 1 landing here is the chip's noise. ");
        return string.concat(OUT_NOTE, "the ", CatchLib.toString(c.hits), " landings here are the chip's noise. ");
    }

    function catchNote(Card calldata c) internal pure returns (string memory) {
        if (c.status != 1) return "";
        string memory n = CatchLib.toString(c.catchable);
        string memory note = string.concat(
            "Caught: rank ",
            CatchLib.toString(c.rank),
            " of ",
            c.catchable == 1 ? "the 1 catchable spot" : string.concat("the ", n, " catchable spots"),
            " tonight by landings, most first. "
        );
        return c.tier == 5 ? string.concat(note, "The chip's very first shot of the night landed here. ") : note;
    }

    /// "Each trait slot drew its own shot: Face landing 1010 (spot 3), Head landing 77 (spot 0), .., Background
    /// landing 3999 (spot 15). " for a caught net, else empty.
    function dnaNote(Card calldata c, Dna calldata d) internal pure returns (bytes memory out) {
        if (c.status != 1) return "";
        out = "Each trait slot drew its own shot:";
        for (uint256 k = 1; k <= 10; ++k) {
            out = abi.encodePacked(
                out,
                k == 1 ? " " : ", ",
                slotName(k),
                " landing ",
                CatchLib.toString(d.landings[k - 1]),
                " (spot ",
                CatchLib.toString(d.spots[k - 1]),
                ")"
            );
        }
        out = abi.encodePacked(out, ". ");
    }

    function reachRule(Card calldata c) internal pure returns (string memory) {
        string memory only = " a perfect walk can only land on spots of the right parity within ";
        if (c.steps == 0) {
            return string.concat(
                "After k steps", only, "k spots of his start (his total turns mod 16): those are the spots in reach. "
            );
        }
        string memory k = CatchLib.toString(c.steps);
        string memory s = c.steps == 1 ? "" : "s";
        return string.concat(
            "After its ",
            k,
            " step",
            s,
            only,
            k,
            " spot",
            s,
            " of his start (spot ",
            CatchLib.toString(c.start),
            "): those are the spots in reach tonight. "
        );
    }

    function reachName(Card calldata c) internal pure returns (string memory) {
        if (c.reach == 1) return "In reach";
        if (c.reach == 2) return "Out of reach tonight";
        if (c.status == 3) return "No run";
        if (c.status == 5) return "Drawing";
        return c.status == 0 ? "Not known yet" : "Not known";
    }

    function _str(string memory k, string memory v) private pure returns (bytes memory) {
        return abi.encodePacked('{"trait_type":"', k, '","value":"', v, '"}');
    }

    function _num(string memory k, string memory v) private pure returns (bytes memory) {
        return abi.encodePacked('{"trait_type":"', k, '","value":', v, "}");
    }

    function statusName(uint8 s) internal pure returns (string memory) {
        if (s == 1) return "Caught";
        if (s == 2) return "Got away";
        if (s == 3) return "He slept";
        if (s == 4) return "No chip result";
        if (s == 5) return "Drawing";
        return "Waiting for the chip";
    }

    function tierName(uint8 t) public pure returns (string memory) {
        if (t == 1) return "Common";
        if (t == 2) return "Uncommon";
        if (t == 3) return "Rare";
        if (t == 4) return "Epic";
        if (t == 5) return "Legendary";
        return "None";
    }

    /// The IBM job id as text when it is plain ASCII [0-9A-Za-z._-] right-padded with zero bytes; anything else is
    /// shown as 0x hex, so the JSON and the SVG can never break.
    function jobString(bytes32 j) internal pure returns (string memory) {
        if (j == bytes32(0)) return "none";
        uint256 len;
        while (len < 32 && j[len] != 0) {
            ++len;
        }
        bool ok = true;
        for (uint256 i; i < 32; ++i) {
            bytes1 b = j[i];
            if (i >= len) {
                if (b != 0) ok = false;
            } else if (
                !((b >= "0" && b <= "9") || (b >= "A" && b <= "Z") || (b >= "a" && b <= "z") || b == "-" || b == "_"
                    || b == ".")
            ) {
                ok = false;
            }
        }
        if (!ok) return hex32(j);
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = j[i];
        }
        return string(out);
    }

    function hex32(bytes32 j) internal pure returns (string memory) {
        bytes memory h = "0123456789abcdef";
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < 32; ++i) {
            out[2 + 2 * i] = h[uint8(j[i]) >> 4];
            out[3 + 2 * i] = h[uint8(j[i]) & 15];
        }
        return string(out);
    }

    // ---------------------------------------------------------------- the card

    function tierColor(uint8 t) internal pure returns (string memory) {
        if (t == 1) return "#e8dfcc";
        if (t == 2) return "#9ee6b5";
        if (t == 3) return "#8fb3ff";
        if (t == 4) return "#c49bff";
        return "#ffd66b"; // 5 Legendary
    }

    function _upper(uint8 t) private pure returns (string memory) {
        if (t == 1) return "COMMON";
        if (t == 2) return "UNCOMMON";
        if (t == 3) return "RARE";
        if (t == 4) return "EPIC";
        return "LEGENDARY";
    }

    string internal constant SVG_OPEN =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" font-family="Verdana,sans-serif">';
    /// Under the painted hamster, Season 1's drawn hamster in the skin's fur colour at scale .48 (no items): a vector
    /// FALLBACK for rasterizers that cannot decode the WebP layers. Wherever WebP decodes, the painted group covers it.
    string internal constant FALLBACK_AT = '<g id="fallback" transform="translate(84.7 83) scale(.48)">';

    /// A caught net's card up to its painted hamster: the svg, the tier colour, the ring, the fallback hamster in
    /// `fur`; and from after it: the caption and the end of the svg.
    function frame(Card calldata c, string calldata fur) external pure returns (bytes memory open, bytes memory tail) {
        string memory spotS = c.spot < 16 ? CatchLib.toString(c.spot) : "";
        open = abi.encodePacked(
            SVG_OPEN,
            '<rect width="320" height="320" fill="',
            tierColor(c.tier),
            '"/>',
            _ring(c, INK),
            FALLBACK_AT,
            _hamster(fur, false),
            "</g>"
        );
        // the caught caption sits 4 units lower than Season 1's (y 250 / 266), clear of the painted hamster's feet
        tail = abi.encodePacked(
            _captionAt(INK, string.concat(unicode"CAUGHT · ", _upper(c.tier)), _landed(c, spotS), "250", "266"),
            "</svg>"
        );
    }

    /// The whole card of a net that did not catch (waiting, got away, he slept, no chip result, drawing): Season 1's.
    function plain(Card calldata c) external pure returns (bytes memory) {
        string memory date = CatchLib.dateString(c.night);
        string memory spotS = c.spot < 16 ? CatchLib.toString(c.spot) : "";
        string memory bg;
        string memory ink;
        bytes memory body;
        string memory label;
        bytes memory sub;
        bool high;
        if (c.status == 2) {
            bg = "#d3d9df";
            ink = "#4a5562";
            body = abi.encodePacked(
                '<g id="net" fill="none" stroke="#7d8794" stroke-width="3"><circle cx="160" cy="150" r="58" ',
                'stroke-dasharray="8 6"/><path d="M122 118l76 64M198 118l-76 64M118 150h84" stroke-width="2" ',
                'opacity=".6"/></g>'
            );
            if (c.reach == 2) {
                body = abi.encodePacked(
                    body,
                    '<g id="outofreach" fill="none" stroke="',
                    ink,
                    '"><rect x="8" y="8" width="78" height="15" rx="7.5"/><text x="47" y="18.5" text-anchor="middle" ',
                    'font-size="8" font-weight="bold" stroke="none" fill="',
                    ink,
                    '">OUT OF REACH</text></g>'
                );
                high = true;
            }
            label = "GOT AWAY";
            sub = _landed(c, spotS);
        } else if (c.status == 3) {
            bg = "#1e2240";
            ink = "#c9d0ff";
            body = abi.encodePacked(
                _hamster("#e3a35f", true), '<text x="218" y="96" font-size="22" fill="#c9d0ff">zzz</text>'
            );
            label = "HE SLEPT";
            sub = abi.encodePacked("night of ", date, ": no run");
        } else if (c.status == 4) {
            bg = "#34303d";
            ink = "#cbc5d8";
            body = abi.encodePacked(
                '<g id="noresult" fill="none" stroke="#6b6580" stroke-width="3"><circle cx="113" cy="104" r="20"/>',
                '<circle cx="207" cy="104" r="20"/><ellipse cx="160" cy="150" rx="64" ry="56"/>',
                '<path d="M138 150h44" stroke-linecap="round"/></g>'
            );
            label = "NO CHIP RESULT";
            sub = "none was posted in time";
        } else {
            bg = "#2b3145";
            ink = "#c3c9dc";
            body = abi.encodePacked(
                '<g id="unknown" fill="#3d4560"><circle cx="113" cy="104" r="20"/><circle cx="207" cy="104" r="20"/>',
                '<ellipse cx="160" cy="150" rx="64" ry="56"/></g><text x="160" y="172" text-anchor="middle" ',
                'font-size="60" font-weight="bold" fill="#8e97b5">?</text>'
            );
            if (c.status == 5) {
                label = "DRAWING";
                sub = abi.encodePacked("night of ", date, '<tspan x="160" dy="12">posted, waiting for the seal</tspan>');
            } else {
                label = "WAITING FOR THE CHIP";
                sub = abi.encodePacked("night of ", date, '<tspan x="160" dy="12">its spot is drawn after the run</tspan>');
            }
            high = true;
        }
        return abi.encodePacked(
            SVG_OPEN,
            '<rect width="320" height="320" fill="',
            bg,
            '"/>',
            _ring(c, ink),
            body,
            _caption(ink, label, sub, high),
            "</svg>"
        );
    }

    function _caption(string memory ink, string memory label, bytes memory sub, bool high)
        private
        pure
        returns (bytes memory)
    {
        return _captionAt(ink, label, sub, high ? "236" : "246", high ? "252" : "262");
    }

    function _captionAt(string memory ink, string memory label, bytes memory sub, string memory y1, string memory y2)
        private
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            '<text x="160" y="',
            y1,
            '" text-anchor="middle" font-size="13" font-weight="bold" fill="',
            ink,
            '">',
            label,
            '</text><text x="160" y="',
            y2,
            '" text-anchor="middle" font-size="9" fill="',
            ink,
            '">',
            sub,
            "</text>"
        );
    }

    function _landed(Card calldata c, string memory spotS) private pure returns (bytes memory) {
        if (c.reach == 2) {
            return abi.encodePacked(
                CatchLib.toString(c.hits),
                " of ",
                CatchLib.toString(c.shots),
                " shots: chip noise",
                '<tspan x="160" dy="12">he could not land here</tspan>'
            );
        }
        return abi.encodePacked(
            CatchLib.toString(c.hits), " of ", CatchLib.toString(c.shots), " shots on spot ", spotS
        );
    }

    /// The 16 spots, clockwise from the top; after a draw each dot's size shows how often the chip landed there and the
    /// dashed circle is where this net's drawn shot landed.
    function _ring(Card calldata c, string memory ink) private pure returns (bytes memory out) {
        bool ran = c.status == 1 || c.status == 2;
        out = abi.encodePacked('<g fill="', ink, '" fill-opacity=".35">');
        for (uint256 i; i < 16; ++i) {
            uint256 r = 4;
            if (ran) {
                uint256 h = (c.counts >> (16 * i)) & 0xFFFF;
                r = 2 + (h * 100) / c.shots; // 1 % -> 3, 5 % -> 7, 10 % and up -> 12
                if (r > 12) r = 12;
            }
            out = abi.encodePacked(
                out, '<circle cx="160" cy="20" r="', CatchLib.toString(r), '" transform="rotate(', _angle(i), ' 160 160)"/>'
            );
        }
        out = abi.encodePacked(out, "</g>");
        if (c.spot >= 16) return out;
        out = abi.encodePacked(
            out,
            '<circle id="mynet" cx="160" cy="20" r="15" fill="none" stroke="',
            ink,
            '" stroke-width="2.5" stroke-dasharray="4 3" transform="rotate(',
            _angle(c.spot),
            ' 160 160)"/>'
        );
    }

    function _angle(uint256 i) private pure returns (string memory) {
        string memory whole = CatchLib.toString((i * 45) / 2);
        return i % 2 == 1 ? string.concat(whole, ".5") : whole;
    }

    /// Season 1's drawn hamster (calm face, no items) in fur colour `fur`; asleep: closed eyes.
    function _hamster(string memory fur, bool asleep) private pure returns (bytes memory) {
        bytes memory head_ = abi.encodePacked(
            '<g id="hamster"><circle cx="113" cy="104" r="20" fill="',
            fur,
            '"/><circle cx="207" cy="104" r="20" fill="',
            fur,
            '"/><circle cx="113" cy="104" r="11" fill="',
            PINK,
            '"/><circle cx="207" cy="104" r="11" fill="',
            PINK,
            '"/><ellipse cx="160" cy="150" rx="64" ry="56" fill="',
            fur,
            '"/><ellipse cx="160" cy="170" rx="36" ry="27" fill="#fbe7c9"/><circle cx="114" cy="166" r="9" fill="',
            PINK,
            '" opacity=".6"/><circle cx="206" cy="166" r="9" fill="',
            PINK,
            '" opacity=".6"/><ellipse cx="160" cy="161" rx="6" ry="4.5" fill="#c9566d"/>'
        );
        if (asleep) {
            return abi.encodePacked(
                head_,
                '<path d="M129 140q7 6 14 0M177 140q7 6 14 0M152 174q8 4 16 0" fill="none" stroke="',
                INK,
                '" stroke-width="2.5" stroke-linecap="round"/></g>'
            );
        }
        return abi.encodePacked(
            head_,
            '<circle cx="136" cy="140" r="6.5" fill="',
            INK,
            '"/><circle cx="184" cy="140" r="6.5" fill="',
            INK,
            '"/><circle cx="138" cy="138" r="2" fill="#fff"/><circle cx="186" cy="138" r="2" fill="#fff"/>',
            '<path id="calm" d="M151 173q9 7 18 0" fill="none" stroke="#26201c" stroke-width="2.5" stroke-linecap="round"/>',
            "</g>"
        );
    }
}
