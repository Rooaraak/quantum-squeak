// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {CatchBase} from "./Base.t.sol";

/// Representative calls for the gas report (forge test --gas-report). The gasleft() numbers logged here are the
/// execution cost of the call inside one test transaction (no 21k base, warm contract); the report is the reference.
contract CatchGasTest is CatchBase {
    function test_gas_castNet() public {
        vm.prank(alice);
        uint256 g = gasleft();
        qc.castNet(5);
        console2.log("castNet (first net of a wallet)", g - gasleft());
        vm.warp(LOCK_1104);
        vm.prank(alice);
        g = gasleft();
        qc.castNet(6);
        console2.log("castNet (wallet already holds a net)", g - gasleft());
    }

    function test_gas_postNight() public {
        vm.warp(OVER_1104);
        uint16[16] memory c = _counts1104();
        vm.prank(hatcher);
        uint256 g = gasleft();
        qc.postNight(N1104, c, TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, FIRST_1104);
        console2.log("postNight (ran)", g - gasleft());
        uint16[16] memory zero;
        vm.prank(hatcher);
        g = gasleft();
        qc.postNight(N1104 - 1, zero, 0, 0, 0, 0, 0);
        console2.log("postNight (he slept)", g - gasleft());
    }

    function test_gas_transfers() public {
        uint256 id = _cast(alice, 5);
        vm.prank(alice);
        uint256 g = gasleft();
        qc.transferFrom(alice, bob, id);
        console2.log("transferFrom (to a new holder)", g - gasleft());
        vm.prank(bob);
        g = gasleft();
        qc.safeTransferFrom(bob, carol, id);
        console2.log("safeTransferFrom (to an EOA)", g - gasleft());
    }

    function test_gas_tokenURI() public {
        uint256 a = _cast(alice, 15);
        uint256 b = _cast(bob, 0);
        uint256 g = gasleft();
        qc.tokenURI(a);
        console2.log("tokenURI (waiting)", g - gasleft());
        _post1104();
        g = gasleft();
        qc.tokenURI(a);
        console2.log("tokenURI (caught, Common)", g - gasleft());
        g = gasleft();
        qc.tokenURI(b);
        console2.log("tokenURI (got away, out of reach)", g - gasleft());
        g = gasleft();
        qc.result(a);
        console2.log("result", g - gasleft());
    }
}
