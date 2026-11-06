// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {ArtDeployer} from "./DeployArt.s.sol";
import {PaintedArt} from "../src/PaintedArt.sol";
import {QuantumCatch, IPaintedArt} from "../src/QuantumCatch.sol";

/// Deploy the whole game: the 15 ArtChunk data contracts, PaintedArt (it checks every chunk's code hash and the order),
/// then QuantumCatch(HATCHER, PaintedArt), whose constructor creates its metadata renderer (CatchArt). 17 transactions,
/// each under the 16,777,216 per-transaction gas cap (EIP-7825). HATCHER comes from the environment; nothing else is
/// configurable (there is nothing to set, and the art can never change).
///   local anvil:  HATCHER=0x... forge script script/DeployAll.s.sol --offline --rpc-url http://127.0.0.1:8546 \
///                   --broadcast --slow --unlocked --sender <an anvil account>
/// (--slow: one transaction at a time. A 30M-gas block holds only 4 of the ~7M-gas chunk deploys, and anvil's automine
/// does not start another block for the rest of a batch.)
/// Local anvil only for now: nothing of Quantum Catch is on Sepolia yet (contracts/README.md, Before deploying).
/// Prints every address: "ArtChunk <k> <address>" x 15, "PaintedArt", "QuantumCatch", "RENDERER", "HATCHER", "chain".
contract DeployAll is ArtDeployer {
    function run() external returns (QuantumCatch qc, PaintedArt art) {
        require(block.chainid == 31337, "DeployAll: local anvil only");
        address hatcher = vm.envAddress("HATCHER");
        vm.startBroadcast();
        address[] memory chunks;
        (art, chunks) = _deployArt();
        qc = new QuantumCatch(hatcher, IPaintedArt(address(art)));
        vm.stopBroadcast();
        require(address(qc.ART()) == address(art), "DeployAll: ART");
        require(qc.HATCHER() == hatcher, "DeployAll: HATCHER");
        _logArt(art, chunks);
        console2.log("QuantumCatch", address(qc));
        console2.log("RENDERER", address(qc.RENDERER()));
        console2.log("HATCHER", qc.HATCHER());
        console2.log("chain", block.chainid);
    }
}
