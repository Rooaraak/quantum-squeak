// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {ArtDeployer} from "./DeployArt.s.sol";
import {PaintedArt} from "../src/PaintedArt.sol";
import {QuantumCatch, IPaintedArt, ISqk} from "../src/QuantumCatch.sol";

/// Deploy the whole game: the 15 ArtChunk data contracts, PaintedArt (it checks every chunk's code hash and the order),
/// then QuantumCatch(HATCHER, PaintedArt, SQK, NET_COST), whose constructor creates its metadata renderer (CatchArt).
/// 17 transactions, each under the 16,777,216 per-transaction gas cap (EIP-7825). HATCHER comes from the environment,
/// and optionally SQK + NET_COST (wei) for paid nets (unset: free nets, SQK = 0, NET_COST = 0); nothing else is
/// configurable (there is nothing to set, and the art can never change).
///   local anvil:  HATCHER=0x... [SQK=0x... NET_COST=10000000000000000] forge script script/DeployAll.s.sol --offline \
///                   --rpc-url http://127.0.0.1:8546 --broadcast --slow --unlocked --sender <an anvil account>
/// (--slow: one transaction at a time. A 30M-gas block holds only 4 of the ~7M-gas chunk deploys, and anvil's automine
/// does not start another block for the rest of a batch.)
/// Local anvil only: it refuses any other chain.
/// Prints every address: "ArtChunk <k> <address>" x 15, "PaintedArt", "QuantumCatch", "RENDERER", "HATCHER", "chain".
contract DeployAll is ArtDeployer {
    function run() external returns (QuantumCatch qc, PaintedArt art) {
        require(block.chainid == 31337, "DeployAll: local anvil only");
        address hatcher = vm.envAddress("HATCHER");
        ISqk sqk = ISqk(vm.envOr("SQK", address(0)));
        uint256 netCost = vm.envOr("NET_COST", uint256(0));
        vm.startBroadcast();
        address[] memory chunks;
        (art, chunks) = _deployArt();
        qc = new QuantumCatch(hatcher, IPaintedArt(address(art)), sqk, netCost);
        vm.stopBroadcast();
        require(address(qc.ART()) == address(art), "DeployAll: ART");
        require(qc.HATCHER() == hatcher, "DeployAll: HATCHER");
        require(qc.SQK() == sqk && qc.NET_COST() == netCost, "DeployAll: SQK");
        _logArt(art, chunks);
        console2.log("QuantumCatch", address(qc));
        console2.log("RENDERER", address(qc.RENDERER()));
        console2.log("HATCHER", qc.HATCHER());
        console2.log("SQK", address(qc.SQK()));
        console2.log("NET_COST", qc.NET_COST());
        console2.log("chain", block.chainid);
    }
}
