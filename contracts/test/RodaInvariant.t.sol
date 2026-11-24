// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RodaBase} from "./RodaCircle.t.sol";
import {RodaCircle} from "../src/RodaCircle.sol";
import {TestDollar} from "../src/TestDollar.sol";

contract Handler is Test {
    RodaCircle public circle;
    TestDollar public usd;
    address[] public actors;
    uint256 public withdrawn;
    uint256 public paidIn;

    constructor(RodaCircle circle_, TestDollar usd_, address[] memory actors_) {
        circle = circle_;
        usd = usd_;
        actors = actors_;
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function join(uint256 seed) external {
        address a = _actor(seed);
        uint256 before = usd.balanceOf(a);
        vm.prank(a);
        try circle.join() {
            paidIn += before - usd.balanceOf(a);
        } catch {}
    }

    function leave(uint256 seed) external {
        address a = _actor(seed);
        uint256 before = usd.balanceOf(a);
        vm.prank(a);
        try circle.leave() {
            withdrawn += usd.balanceOf(a) - before;
        } catch {}
    }

    function contribute(uint256 seed) external {
        address a = _actor(seed);
        vm.prank(a);
        try circle.contribute() {
            paidIn += circle.contribution();
        } catch {}
    }

    function bid(uint256 seed, uint256 amount) external {
        vm.prank(_actor(seed));
        try circle.bid(bound(amount, 1, circle.maxBid())) {} catch {}
    }

    function repay(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 before = usd.balanceOf(a);
        vm.prank(a);
        try circle.repay(bound(amount, 1, 1_000e6)) {
            paidIn += before - usd.balanceOf(a);
        } catch {}
    }

    function settle(uint256 skipSeed) external {
        vm.warp(block.timestamp + bound(skipSeed, 0, 40 days));
        try circle.settle() {} catch {}
    }

    function cancel() external {
        try circle.cancel() {} catch {}
    }

    function withdraw(uint256 seed) external {
        address a = _actor(seed);
        uint256 before = usd.balanceOf(a);
        vm.prank(a);
        try circle.withdraw() {
            withdrawn += usd.balanceOf(a) - before;
        } catch {}
    }
}

contract RodaInvariantTest is RodaBase {
    RodaCircle internal circle;
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        circle = _create(5, 2 * C, 0);
        address[] memory actors = new address[](7);
        for (uint256 i; i < 7; ++i) {
            actors[i] = users[i];
            vm.prank(users[i]);
            usd.approve(address(circle), type(uint256).max);
        }
        handler = new Handler(circle, usd, actors);
        targetContract(address(handler));
    }

    /// The circle always holds exactly what it owes.
    function invariant_balanceMatchesLiabilities() public view {
        assertEq(usd.balanceOf(address(circle)), _accounted(circle));
    }

    /// Money in equals money out plus what is still held.
    function invariant_conservation() public view {
        assertEq(handler.paidIn(), handler.withdrawn() + usd.balanceOf(address(circle)));
    }

    function invariant_roundNeverExceedsSize() public view {
        assertLe(circle.round(), circle.size());
        assertLe(circle.memberCount(), circle.size());
        if (circle.status() == RodaCircle.Status.Completed) {
            assertEq(circle.round(), circle.size());
            assertEq(circle.carry(), 0);
            assertEq(circle.roundCollected(), 0);
        }
    }

    /// At most one member takes the pot per round.
    function invariant_onePotPerRound() public view {
        address[] memory ms = circle.members();
        uint256 received;
        for (uint256 i; i < ms.length; ++i) {
            if (circle.memberInfo(ms[i]).received) ++received;
        }
        assertEq(received, circle.round());
    }
}
