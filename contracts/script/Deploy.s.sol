// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {RodaFactory} from "../src/RodaFactory.sol";
import {TestDollar} from "../src/TestDollar.sol";

/// Deploys the factory (which deploys the circle implementation and reputation ledger) and allowlists
/// the stablecoins. USDG is the Paxos Global Dollar address for the target chain; set DEPLOY_TEST_DOLLAR=true
/// on testnets to also deploy a faucet token so anyone can try the app without sourcing USDG.
contract Deploy is Script {
    function run() external {
        address usdg = vm.envOr("USDG", address(0));
        bool withTestDollar = vm.envOr("DEPLOY_TEST_DOLLAR", false);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        RodaFactory factory = new RodaFactory(deployer);
        if (usdg != address(0)) factory.setTokenAllowed(usdg, true);
        if (withTestDollar) {
            TestDollar tusd = new TestDollar();
            factory.setTokenAllowed(address(tusd), true);
            console2.log("TestDollar", address(tusd));
        }
        vm.stopBroadcast();

        console2.log("RodaFactory", address(factory));
        console2.log("RodaCircle implementation", address(factory.implementation()));
        console2.log("RodaReputation", address(factory.reputation()));
    }
}
