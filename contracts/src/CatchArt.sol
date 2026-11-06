// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchLib} from "./CatchLib.sol";

/// On-chain metadata for a Quantum Catch net: JSON + an SVG card, both base64 data URIs. A caught net shows the painted
/// hamster when the contract passes one (QuantumCatch.ART), else the small hand-made one.
/// A contract of its own (not a library) only to keep QuantumCatch under the EIP-170 size cap: QuantumCatch's constructor
/// creates it (QuantumCatch.RENDERER), and it has no storage, no owner and only pure functions, so it can never change.
contract CatchArt {
    struct Card {
        uint8 status; // 0 waiting for the chip, 1 caught, 2 got away, 3 he slept, 4 no chip result
        uint32 night;
        uint8 spot; // the spot the net's drawn shot landed on; 255 (none) until a ran night is posted
        uint16 hits;
        uint32 shots;
        uint8 tier; // 0 none, 1 Common .. 5 Legendary
        uint8 reach; // 0 not known, 1 in reach, 2 out of reach tonight (never catches: landings there are chip noise)
        uint8 steps; // the walk's steps that night (0 until a ran night is posted)
        uint8 start; // his start: the ring turn, turns % 16 (0 until a ran night is posted)
        uint8 firstShot; // the spot the chip's very first shot landed on (0 until a ran night is posted)
        uint8 rank; // the spot's rank among the night's catchable spots by landings, 1 = most (0 = not catchable)
        uint8 catchable; // how many spots were catchable that night (0 until a ran night is posted)
        uint256 counts; // the night's 16 per-spot landings, 16 bits each (0 while waiting)
        bytes32 jobId;
        bytes32 sha; // sha256 of the result file the counts come from
    }

    /// Inlined into JSON: no double quotes, no backslashes. The description is HEAD, then the net's own note (its drawn
    /// spot; out of reach: why it got away; caught: its rank), then WHEEL, the reach rule (with the night's steps and
    /// his start once they are posted), then RULES. HEAD says nothing about a price: the renderer does not know
    /// whether its game takes test SQK for a net (QuantumCatch.NET_COST).
    string internal constant HEAD = "Sepolia test NFT, no value. ";
    string internal constant WHEEL =
        "A net for one night of Quantum Catch: a ticket for one of the chip's shots, nobody picks a spot. The real "
        "hamster Squeektoshi's wheel run that night (read from SqueekCore by the hatcher) programs a quantum walk on a "
        "ring of 16 spots, which runs on a real IBM quantum computer the next day. ";
    string internal constant RULES =
        "Once the night's result is posted, each net gets one of the chip's shots that night, drawn at random over all "
        "its landings (keccak256 of the night, the result file's sha256, the IBM job id and the net's token id, modulo "
        "the shots, counted through the spots in order), so a spot with more landings is drawn more often; the nets "
        "close before the chip runs, so no caster can know or choose a draw; the hatcher, which posts the result, sees "
        "the draws first and is trusted for them as for every number. A spot is catchable tonight if it is in reach "
        "and the chip lands there in at least 1% of its shots: a net whose shot landed on a catchable spot catches that "
        "spot's hamster; otherwise the hamster got away. The tier is the spot's rank among tonight's catchable spots by "
        "landings, most first (equal landings: the lower spot number first): the last one is Epic, the one before it "
        "Rare, the two before those Uncommon, all others Common. Legendary is the Epic spot when the chip's very first "
        "shot of the night landed on it. A shot on a spot out of reach tonight never catches: he could not land there, "
        "so any landings there are the chip's own noise. A night he slept draws nothing. The hatcher's only power is to "
        "post each night's numbers once (the landings per spot, his turns, the steps, the spot of the first shot, the "
        "IBM job and the file's sha256), within 14 days after the night ends: it is not a player, it cannot mint, move "
        "or burn nets, and this contract cannot check its numbers (check them against the result file, by its IBM job "
        "and sha256; the first shot is the first entry of its shots_in_order plus his total turns, mod 16). If nothing "
        "is posted in time, the net reads No chip result for good. Only a net's holder, or an address it approves, can "
        "burn it.";
    string internal constant OUT_NOTE = "Out of reach tonight: he could not land here; ";

    string internal constant INK = "#26201c";
    string internal constant FUR = "#e3a35f";
    string internal constant PINK = "#f2a7b5";

    /// @param painted the painted hamster (an SVG <g> fragment of 448 x 600 user units) for a caught net, or empty for
    ///        the drawn one
    function tokenURI(Card memory c, string memory painted) external pure returns (string memory) {
        string memory date = CatchLib.dateString(c.night);
        string memory spotS = c.spot < 16 ? CatchLib.toString(c.spot) : "";
        string memory image = CatchLib.base64(svg(c, date, spotS, painted));
        bytes memory json = abi.encodePacked(
            '{"name":"Quantum Catch: night of ',
            c.spot < 16 ? string.concat(date, ", spot ", spotS) : date,
            '","description":"',
            _description(c),
            '","attributes":[',
            _attributes(c, date, spotS),
            '],"image":"data:image/svg+xml;base64,',
            image,
            '"}'
        );
        return string.concat("data:application/json;base64,", CatchLib.base64(json));
    }

    function _description(Card memory c) private pure returns (bytes memory) {
        bytes memory notes = abi.encodePacked(HEAD, drawNote(c), reachNote(c), catchNote(c));
        return abi.encodePacked(notes, WHEEL, reachRule(c), RULES);
    }

    // ---------------------------------------------------------------- attributes

    /// Night, Spot (once drawn), Status, Tier, the caught hamster's Hat / Glasses / Neckwear / Face (only when caught),
    /// then Landings, Shots, IBM job, Steps, Reach, Result sha256, First shot
    function _attributes(Card memory c, string memory date, string memory spotS)
        private
        pure
        returns (bytes memory out)
    {
        out = _str("Night", date);
        if (c.spot < 16) out = abi.encodePacked(out, ",", _num("Spot", spotS));
        out = abi.encodePacked(out, ",", _str("Status", statusName(c.status)), ",", _str("Tier", tierName(c.tier)));
        if (c.status == 1) out = abi.encodePacked(out, ",", _looks(c.spot));
        return abi.encodePacked(out, ",", _tail(c));
    }

    function _looks(uint8 s) private pure returns (bytes memory) {
        return abi.encodePacked(
            _str("Hat", s & 1 == 1 ? "Yes" : "No"),
            ",",
            _str("Glasses", (s >> 1) & 1 == 1 ? "Yes" : "No"),
            ",",
            _str("Neckwear", (s >> 2) & 1 == 1 ? "Yes" : "No"),
            ",",
            _str("Face", (s >> 3) & 1 == 1 ? "Grin" : "Calm")
        );
    }

    function _tail(Card memory c) private pure returns (bytes memory) {
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
            _str("First shot", c.shots == 0 ? "none" : string.concat("spot ", CatchLib.toString(c.firstShot)))
        );
    }

    /// A net with a drawn shot says where it landed: "Its shot landed on spot 5. " Empty before the draw.
    function drawNote(Card memory c) internal pure returns (string memory) {
        if (c.spot >= 16) return "";
        return string.concat("Its shot landed on spot ", CatchLib.toString(c.spot), ". ");
    }

    /// A net whose shot landed out of reach tonight (it got away: a perfect walk could not land there) says why, with
    /// the landings there (at least the drawn one): "Out of reach tonight: he could not land here; the 40 landings
    /// here are the chip's noise. " In reach under 1 %: "Under 1% of the shots landed here: the hamster got away. "
    /// Empty otherwise.
    function reachNote(Card memory c) internal pure returns (string memory) {
        if (c.status == 2 && c.reach == 1) return "Under 1% of the shots landed here: the hamster got away. ";
        if (c.reach != 2) return "";
        if (c.hits == 1) return string.concat(OUT_NOTE, "the 1 landing here is the chip's noise. ");
        return string.concat(OUT_NOTE, "the ", CatchLib.toString(c.hits), " landings here are the chip's noise. ");
    }

    /// A caught net says where it ranked: "Caught: rank 7 of the 8 catchable spots tonight by landings, most first. ", and
    /// a Legendary adds "The chip's very first shot of the night landed here. " Empty otherwise.
    function catchNote(Card memory c) internal pure returns (string memory) {
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

    /// Where a perfect walk can land (QuantumCatch._inReach), exactly: "After its 10 steps a perfect walk can only land
    /// on spots of the right parity within 10 spots of his start (spot 9): those are the spots in reach tonight." Before
    /// a ran night is posted (and when he slept) the same with k for the steps.
    function reachRule(Card memory c) internal pure returns (string memory) {
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

    function reachName(Card memory c) internal pure returns (string memory) {
        if (c.reach == 1) return "In reach";
        if (c.reach == 2) return "Out of reach tonight";
        if (c.status == 3) return "No run";
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
        return "Waiting for the chip";
    }

    function tierName(uint8 t) internal pure returns (string memory) {
        if (t == 1) return "Common";
        if (t == 2) return "Uncommon";
        if (t == 3) return "Rare";
        if (t == 4) return "Epic";
        if (t == 5) return "Legendary";
        return "None";
    }

    /// The IBM job id as text when it is plain ASCII [0-9A-Za-z._-] right-padded with zero bytes; anything else
    /// (quotes, control bytes, a zero byte inside) is shown as 0x hex, so the JSON and the SVG can never break.
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

    // ---------------------------------------------------------------- image

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

    /// The painted hamster (448 x 600 user units, its figure about x 90..360, y 69..534 with a hat) at scale .4 with its
    /// middle on x 160: the figure spans about x 106..214, y 42..228, where the drawn hamster stands (y 36..228), inside
    /// the ring of dots and above the caption (cap top about y 236.5).
    string internal constant PAINTED_AT = '<g id="painted" transform="translate(70.4 14.4) scale(.4)">';
    /// Under the painted hamster, the drawn one with the same items at scale .48 (it spans about x 128..196, y 107..199):
    /// a vector FALLBACK for rasterizers that cannot decode the WebP layers (sharp/libvips thumbnailers drop them, and
    /// the card would show no hamster). It lies wholly inside the opaque part of every painted look x tier with 4.4
    /// units to spare (tools/fallback_fit.py), so wherever WebP decodes, the painted hamster covers it pixel for pixel
    /// (script/fallback-check.mjs, Chrome: all 80 caught cards identical with and without it).
    string internal constant FALLBACK_AT = '<g id="fallback" transform="translate(84.7 89) scale(.48)">';

    function svg(Card memory c, string memory date, string memory spotS, string memory painted)
        internal
        pure
        returns (bytes memory)
    {
        string memory bg;
        string memory ink;
        bytes memory body;
        string memory label;
        bytes memory sub;
        bool high; // a two-line caption (out of reach) sits 10 px higher
        if (c.status == 1) {
            bg = tierColor(c.tier);
            ink = INK;
            body = bytes(painted).length > 0
                ? abi.encodePacked(FALLBACK_AT, _hamster(c.spot, false), "</g>", PAINTED_AT, painted, "</g>")
                : _hamster(c.spot, false);
            label = string.concat("CAUGHT &#183; ", _upper(c.tier));
            sub = _landed(c, spotS);
        } else if (c.status == 2) {
            bg = "#d3d9df";
            ink = "#4a5562";
            body = abi.encodePacked(
                '<g id="net" fill="none" stroke="#7d8794" stroke-width="3"><circle cx="160" cy="150" r="58" ',
                'stroke-dasharray="8 6"/><path d="M122 118l76 64M198 118l-76 64M118 150h84" stroke-width="2" ',
                'opacity=".6"/></g>'
            );
            if (c.reach == 2) {
                // the small out of reach mark: a perfect walk could not land here tonight
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
                _hamster(0, true), '<text x="218" y="96" font-size="22" fill="#c9d0ff">zzz</text>'
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
            label = "WAITING FOR THE CHIP";
            // two lines (in one line it ran into the ring's two lower side dots in Chrome): the date, then the draw
            sub = abi.encodePacked("night of ", date, '<tspan x="160" dy="12">its spot is drawn after the run</tspan>');
            high = true;
        }
        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" font-family="Verdana,sans-serif">',
            '<rect width="320" height="320" fill="',
            bg,
            '"/>',
            _ring(c, ink),
            body,
            _caption(ink, label, sub, high),
            "</svg>"
        );
    }

    /// The label (13 px bold) and the line under it (9 px). A two-line caption (out of reach: "... chip noise" and
    /// "he could not land here" 12 px lower; waiting: "night of <date>" and "its spot is drawn after the run") is 10 px
    /// higher, at y 236 / 252 / 264, so its last line stays 9 px clear of the dashed net on spots 7 and 9 (top edge y
    /// 273.1); otherwise y 246 / 262.
    function _caption(string memory ink, string memory label, bytes memory sub, bool high)
        private
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            '<text x="160" y="',
            high ? "236" : "246",
            '" text-anchor="middle" font-size="13" font-weight="bold" fill="',
            ink,
            '">',
            label,
            '</text><text x="160" y="',
            high ? "252" : "262",
            '" text-anchor="middle" font-size="9" fill="',
            ink,
            '">',
            sub,
            "</text>"
        );
    }

    /// "308 of 4000 shots on spot 5" (the drawn shot's spot), or, when a perfect walk cannot land there, "46 of 4000
    /// shots: chip noise" with a second line "he could not land here" (short, no descenders: it sits just above the
    /// bottom spots of the ring). A drawn spot always has a landing (the drawn shot).
    function _landed(Card memory c, string memory spotS) private pure returns (bytes memory) {
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

    /// The 16 spots, clockwise from the top. After a run each dot's size shows how often the chip landed there;
    /// the dashed circle is where this net's drawn shot landed (none before the draw).
    function _ring(Card memory c, string memory ink) private pure returns (bytes memory out) {
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
        if (c.spot >= 16) return out; // nothing drawn yet (or he slept, or no chip result): no net on the ring
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

    /// The hamster: honey fur, pink ears; spot bit 0 party hat, bit 1 glasses, bit 2 scarf, bit 3 grin (else calm).
    function _hamster(uint8 looks, bool asleep) private pure returns (bytes memory) {
        bytes memory head = abi.encodePacked(
            '<g id="hamster"><circle cx="113" cy="104" r="20" fill="',
            FUR,
            '"/><circle cx="207" cy="104" r="20" fill="',
            FUR,
            '"/><circle cx="113" cy="104" r="11" fill="',
            PINK,
            '"/><circle cx="207" cy="104" r="11" fill="',
            PINK,
            '"/><ellipse cx="160" cy="150" rx="64" ry="56" fill="',
            FUR,
            '"/><ellipse cx="160" cy="170" rx="36" ry="27" fill="#fbe7c9"/><circle cx="114" cy="166" r="9" fill="',
            PINK,
            '" opacity=".6"/><circle cx="206" cy="166" r="9" fill="',
            PINK,
            '" opacity=".6"/><ellipse cx="160" cy="161" rx="6" ry="4.5" fill="#c9566d"/>'
        );
        bytes memory face;
        if (asleep) {
            face = abi.encodePacked(
                '<path d="M129 140q7 6 14 0M177 140q7 6 14 0M152 174q8 4 16 0" fill="none" stroke="',
                INK,
                '" stroke-width="2.5" stroke-linecap="round"/></g>'
            );
            return abi.encodePacked(head, face);
        }
        face = abi.encodePacked(
            '<circle cx="136" cy="140" r="6.5" fill="',
            INK,
            '"/><circle cx="184" cy="140" r="6.5" fill="',
            INK,
            '"/><circle cx="138" cy="138" r="2" fill="#fff"/><circle cx="186" cy="138" r="2" fill="#fff"/>',
            (looks >> 3) & 1 == 1
                ? '<path id="grin" d="M145 170q15 20 30 0z" fill="#8a2f45" stroke="#26201c" stroke-width="2" stroke-linejoin="round"/>'
                : '<path id="calm" d="M151 173q9 7 18 0" fill="none" stroke="#26201c" stroke-width="2.5" stroke-linecap="round"/>',
            "</g>"
        );
        bytes memory extras;
        if ((looks >> 2) & 1 == 1) {
            extras = abi.encodePacked(
                extras,
                '<g id="scarf"><path d="M104 190q56 30 112 0l3 15q-59 32-118 0z" fill="#e0524f"/>',
                '<path d="M186 206l7 22 14-4-6-20z" fill="#c2403e"/></g>'
            );
        }
        if ((looks >> 1) & 1 == 1) {
            extras = abi.encodePacked(
                extras,
                '<g id="glasses" fill="none" stroke="',
                INK,
                '" stroke-width="3.5"><circle cx="136" cy="140" r="14"/><circle cx="184" cy="140" r="14"/>',
                '<path d="M150 140h20M122 136l-14-5M198 136l14-5"/></g>'
            );
        }
        if (looks & 1 == 1) {
            extras = abi.encodePacked(
                extras,
                '<g id="hat"><path d="M160 44l-24 54h48z" fill="#5b6cff"/><path d="M148 70h24M142 84h36" ',
                'stroke="#ffd36b" stroke-width="4"/><circle cx="160" cy="43" r="7" fill="#ff6b8a"/></g>'
            );
        }
        return abi.encodePacked(head, face, extras);
    }
}
