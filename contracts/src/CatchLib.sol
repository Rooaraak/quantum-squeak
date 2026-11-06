// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Small pure helpers for the on-chain metadata: civil dates, decimal strings, base64.
library CatchLib {
    bytes internal constant B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /// Civil (proleptic Gregorian) date of a day count since 1970-01-01 (H. Hinnant's civil_from_days).
    function civil(uint256 z) internal pure returns (uint256 y, uint256 m, uint256 d) {
        z += 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097; // [0, 146096]
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
        uint256 mp = (5 * doy + 2) / 153; // [0, 11], March = 0
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }

    /// "YYYY-MM-DD" (years from 1970 on, so always at least 4 digits).
    function dateString(uint256 days_) internal pure returns (string memory) {
        (uint256 y, uint256 m, uint256 d) = civil(days_);
        return string.concat(toString(y), "-", _two(m), "-", _two(d));
    }

    function _two(uint256 v) private pure returns (string memory) {
        return v < 10 ? string.concat("0", toString(v)) : toString(v);
    }

    function toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) {
            ++len;
        }
        bytes memory b = new bytes(len);
        for (; v != 0; v /= 10) {
            b[--len] = bytes1(uint8(48 + (v % 10)));
        }
        return string(b);
    }

    /// Standard base64 (RFC 4648, with '=' padding). From 24 bytes on, it first builds a table of the two characters of
    /// every 12-bit value (8 KiB, after the free memory pointer, never allocated) and turns each 24 input bytes into one
    /// 32-character word (16 table reads); the last 0 to 23 bytes go 3 at a time with the 64-character table. About a
    /// third of the gas of 3 at a time throughout (the painted images are about 100 KB, encoded twice per tokenURI).
    function base64(bytes memory data) internal pure returns (string memory result) {
        uint256 len = data.length;
        if (len == 0) return "";
        bytes memory table = B64;
        result = new string(4 * ((len + 2) / 3));
        assembly ("memory-safe") {
            // The loops read whole 32-byte words, so up to 8 bytes past the end of `data` are read (only the last group
            // of the 3-at-a-time loop uses any of them: its low bits). Zero the word after `data` while encoding (and put
            // it back after) so those bits are clean.
            let afterPtr := add(add(data, 0x20), len)
            let afterCache := mload(afterPtr)
            mstore(afterPtr, 0)

            let tdata := add(table, 0x20)
            let p := add(data, 0x20) // the next input byte
            let out := add(result, 0x20) // the next output character
            if iszero(lt(len, 24)) {
                // the 12-bit table at t: entry v = the characters of v >> 6 and v & 63, at bytes [t + 2v, t + 2v + 2)
                let t := mload(0x40)
                // lp: 4 words, word k = the characters 16k .. 16k + 15 at the odd bytes (1, 3, .., 31), zero between
                let lp := add(t, 8192)
                mstore(lp, 0)
                mstore(add(lp, 0x20), 0)
                mstore(add(lp, 0x40), 0)
                mstore(add(lp, 0x60), 0)
                for { let i := 0 } lt(i, 64) { i := add(i, 1) } {
                    let at := add(lp, shl(5, shr(4, i)))
                    mstore(at, or(shl(16, mload(at)), shr(248, mload(add(tdata, i)))))
                }
                let ones := mul(div(not(0), 0xffff), 0x100) // 0x01 at the even bytes (0, 2, .., 30)
                for { let hi := 0 } lt(hi, 64) { hi := add(hi, 1) } {
                    let c := mul(shr(248, mload(add(tdata, hi))), ones) // character hi at the even bytes
                    let at := add(t, shl(7, hi))
                    mstore(at, or(c, mload(lp)))
                    mstore(add(at, 0x20), or(c, mload(add(lp, 0x20))))
                    mstore(add(at, 0x40), or(c, mload(add(lp, 0x40))))
                    mstore(add(at, 0x60), or(c, mload(add(lp, 0x60))))
                }
                // mload(add(tm, 2v)) has entry v in its low 2 bytes; and(shr(s - 1, w), 0x1ffe) = 2 * (12 bits at s)
                let tm := sub(t, 30)
                for {} iszero(gt(add(p, 24), afterPtr)) {} {
                    let w := mload(p) // the top 24 bytes: 8 groups of 3 bytes = 16 values of 12 bits
                    let acc := or(
                        shl(16, and(mload(add(tm, and(shr(243, w), 0x1ffe))), 0xffff)),
                        and(mload(add(tm, and(shr(231, w), 0x1ffe))), 0xffff)
                    )
                    acc := or(
                        shl(32, acc),
                        or(
                            shl(16, and(mload(add(tm, and(shr(219, w), 0x1ffe))), 0xffff)),
                            and(mload(add(tm, and(shr(207, w), 0x1ffe))), 0xffff)
                        )
                    )
                    acc := or(
                        shl(32, acc),
                        or(
                            shl(16, and(mload(add(tm, and(shr(195, w), 0x1ffe))), 0xffff)),
                            and(mload(add(tm, and(shr(183, w), 0x1ffe))), 0xffff)
                        )
                    )
                    acc := or(
                        shl(32, acc),
                        or(
                            shl(16, and(mload(add(tm, and(shr(171, w), 0x1ffe))), 0xffff)),
                            and(mload(add(tm, and(shr(159, w), 0x1ffe))), 0xffff)
                        )
                    )
                    acc := or(
                        shl(32, acc),
                        or(
                            shl(16, and(mload(add(tm, and(shr(147, w), 0x1ffe))), 0xffff)),
                            and(mload(add(tm, and(shr(135, w), 0x1ffe))), 0xffff)
                        )
                    )
                    acc := or(
                        shl(32, acc),
                        or(
                            shl(16, and(mload(add(tm, and(shr(123, w), 0x1ffe))), 0xffff)),
                            and(mload(add(tm, and(shr(111, w), 0x1ffe))), 0xffff)
                        )
                    )
                    acc := or(
                        shl(32, acc),
                        or(
                            shl(16, and(mload(add(tm, and(shr(99, w), 0x1ffe))), 0xffff)),
                            and(mload(add(tm, and(shr(87, w), 0x1ffe))), 0xffff)
                        )
                    )
                    acc := or(
                        shl(32, acc),
                        or(
                            shl(16, and(mload(add(tm, and(shr(75, w), 0x1ffe))), 0xffff)),
                            and(mload(add(tm, and(shr(63, w), 0x1ffe))), 0xffff)
                        )
                    )
                    mstore(out, acc)
                    p := add(p, 24)
                    out := add(out, 32)
                }
            }

            // the last 0 to 23 bytes, 3 at a time: q + 3 is the address whose word has the next 3 bytes in its low bits
            let tablePtr := add(table, 1)
            for {
                let q := sub(p, 0x20)
                let end := add(data, len)
            } lt(q, end) {} {
                q := add(q, 3)
                let w := mload(q) // low 3 bytes = the next 3 input bytes
                mstore8(out, mload(add(tablePtr, and(shr(18, w), 0x3F))))
                mstore8(add(out, 1), mload(add(tablePtr, and(shr(12, w), 0x3F))))
                mstore8(add(out, 2), mload(add(tablePtr, and(shr(6, w), 0x3F))))
                mstore8(add(out, 3), mload(add(tablePtr, and(w, 0x3F))))
                out := add(out, 4)
            }
            switch mod(len, 3)
            case 1 {
                mstore8(sub(out, 1), 0x3d)
                mstore8(sub(out, 2), 0x3d)
            }
            case 2 { mstore8(sub(out, 1), 0x3d) }

            mstore(afterPtr, afterCache)
        }
    }
}
