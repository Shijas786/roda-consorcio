// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RodaFactory} from "../src/RodaFactory.sol";
import {RodaCircle} from "../src/RodaCircle.sol";
import {RodaReputation} from "../src/RodaReputation.sol";
import {TestDollar} from "../src/TestDollar.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

abstract contract RodaBase is Test {
    uint256 internal constant C = 100e6;
    uint256 internal constant PERIOD = 30 days;

    RodaFactory internal factory;
    RodaReputation internal reputation;
    TestDollar internal usd;
    address internal owner = makeAddr("owner");
    address[] internal users;

    function setUp() public virtual {
        factory = new RodaFactory(owner);
        reputation = factory.reputation();
        usd = new TestDollar();
        vm.prank(owner);
        factory.setTokenAllowed(address(usd), true);
        for (uint256 i; i < 20; ++i) {
            address u = makeAddr(string.concat("user", vm.toString(i)));
            users.push(u);
            deal(address(usd), u, 1_000_000e6);
        }
    }

    function _config(uint256 size, uint256 deposit, uint256 minScore) internal view returns (RodaCircle.Config memory) {
        return RodaCircle.Config({
            token: address(usd),
            contribution: C,
            size: size,
            period: PERIOD,
            deposit: deposit,
            minScore: minScore,
            joinWindow: 7 days,
            name: "Roda da Vila"
        });
    }

    function _create(uint256 size, uint256 deposit, uint256 minScore) internal returns (RodaCircle circle) {
        circle = RodaCircle(factory.createCircle(_config(size, deposit, minScore)));
        for (uint256 i; i < size; ++i) {
            vm.prank(users[i]);
            usd.approve(address(circle), type(uint256).max);
        }
    }

    function _fill(RodaCircle circle) internal {
        uint256 size = circle.size();
        for (uint256 i; i < size; ++i) {
            vm.prank(users[i]);
            circle.join();
        }
    }

    function _started(uint256 size, uint256 deposit) internal returns (RodaCircle circle) {
        circle = _create(size, deposit, 0);
        _fill(circle);
    }

    function _payAll(RodaCircle circle) internal {
        uint256 size = circle.size();
        for (uint256 i; i < size; ++i) {
            _pay(circle, users[i]);
        }
    }

    function _pay(RodaCircle circle, address user) internal {
        uint256 round = circle.round();
        vm.prank(user);
        circle.contribute(round);
    }

    function _settle(RodaCircle circle) internal {
        vm.warp(circle.roundDeadline());
        circle.settle();
    }

    function _accounted(RodaCircle circle) internal view returns (uint256 total) {
        address[] memory ms = circle.members();
        for (uint256 i; i < ms.length; ++i) {
            RodaCircle.Member memory m = circle.memberInfo(ms[i]);
            total += m.deposit + m.claimable;
        }
        total += circle.carry() + circle.roundCollected();
    }
}

contract RodaCircleTest is RodaBase {
    // ------------------------------------------------------------- factory

    function test_createCircle_requiresAllowedToken() public {
        RodaCircle.Config memory c = _config(3, C, 0);
        c.token = address(0xBEEF);
        vm.expectRevert(RodaFactory.TokenNotAllowed.selector);
        factory.createCircle(c);
    }

    function test_setTokenAllowed_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        factory.setTokenAllowed(address(1), true);
    }

    function test_createCircle_rejectsBadConfig() public {
        RodaCircle.Config memory c = _config(2, C, 0);
        vm.expectRevert(RodaCircle.InvalidConfig.selector);
        factory.createCircle(c);

        c = _config(21, C, 0);
        vm.expectRevert(RodaCircle.InvalidConfig.selector);
        factory.createCircle(c);

        c = _config(3, C - 1, 0);
        vm.expectRevert(RodaCircle.InvalidConfig.selector);
        factory.createCircle(c);

        c = _config(3, C, 0);
        c.period = 59;
        vm.expectRevert(RodaCircle.InvalidConfig.selector);
        factory.createCircle(c);
    }

    function test_circles_pagination() public {
        address a = factory.createCircle(_config(3, C, 0));
        address b = factory.createCircle(_config(4, C, 0));
        assertEq(factory.circleCount(), 2);
        address[] memory page = factory.circles(1, 10);
        assertEq(page.length, 1);
        assertEq(page[0], b);
        assertEq(factory.circles(0, 1)[0], a);
        assertEq(factory.circles(5, 1).length, 0);
    }

    function test_implementation_cannotBeInitialized() public {
        RodaCircle impl = RodaCircle(factory.implementation());
        vm.expectRevert();
        impl.initialize(_config(3, C, 0), reputation, address(this));
    }

    function test_circle_cannotBeReinitialized() public {
        RodaCircle circle = _create(3, C, 0);
        vm.expectRevert();
        circle.initialize(_config(3, C, 0), reputation, address(this));
    }

    function test_reputation_onlyCirclesCanRecord() public {
        vm.expectRevert(RodaReputation.NotCircle.selector);
        reputation.record(users[0], address(usd), 0, false, 1);
        vm.expectRevert(RodaReputation.NotFactory.selector);
        reputation.authorize(address(this));
    }

    // ------------------------------------------------------------- forming

    function test_join_locksDepositAndStartsWhenFull() public {
        RodaCircle circle = _create(3, 2 * C, 0);
        uint256 before = usd.balanceOf(users[0]);
        vm.prank(users[0]);
        circle.join();
        assertEq(usd.balanceOf(users[0]), before - 2 * C);
        assertEq(uint256(circle.status()), uint256(RodaCircle.Status.Forming));

        vm.prank(users[0]);
        vm.expectRevert(RodaCircle.AlreadyJoined.selector);
        circle.join();

        vm.prank(users[1]);
        circle.join();
        vm.prank(users[2]);
        circle.join();
        assertEq(uint256(circle.status()), uint256(RodaCircle.Status.Active));
        assertEq(circle.roundDeadline(), block.timestamp + PERIOD);
        assertEq(usd.balanceOf(address(circle)), 6 * C);
    }

    function test_leave_refundsAndKeepsOrder() public {
        RodaCircle circle = _create(4, C, 0);
        for (uint256 i; i < 3; ++i) {
            vm.prank(users[i]);
            circle.join();
        }
        uint256 before = usd.balanceOf(users[0]);
        vm.prank(users[0]);
        circle.leave();
        assertEq(usd.balanceOf(users[0]), before + C);
        address[] memory ms = circle.members();
        assertEq(ms.length, 2);
        assertEq(ms[0], users[1]);
        assertEq(ms[1], users[2]);

        vm.prank(users[0]);
        vm.expectRevert(RodaCircle.NotMember.selector);
        circle.leave();
    }

    function test_cancel_afterJoinWindowUnlocksDeposits() public {
        RodaCircle circle = _create(3, C, 0);
        vm.prank(users[0]);
        circle.join();

        vm.expectRevert(RodaCircle.JoinStillOpen.selector);
        circle.cancel();

        vm.warp(circle.joinDeadline() + 1);
        vm.prank(users[1]);
        vm.expectRevert(RodaCircle.JoinClosed.selector);
        circle.join();

        circle.cancel();
        uint256 before = usd.balanceOf(users[0]);
        vm.prank(users[0]);
        circle.withdraw();
        assertEq(usd.balanceOf(users[0]), before + C);
        assertEq(usd.balanceOf(address(circle)), 0);
    }

    // -------------------------------------------------------------- rounds

    function test_fullCycle_everyonePays_isZeroSum() public {
        RodaCircle circle = _started(5, C);
        uint256[] memory start = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            start[i] = usd.balanceOf(users[i]) + C; // add the deposit back
        }

        for (uint256 r; r < 5; ++r) {
            _payAll(circle);
            _settle(circle);
            assertTrue(circle.memberInfo(users[r]).received, "queue order");
            assertEq(usd.balanceOf(address(circle)), _accounted(circle));
        }
        assertEq(uint256(circle.status()), uint256(RodaCircle.Status.Completed));

        for (uint256 i; i < 5; ++i) {
            vm.prank(users[i]);
            circle.withdraw();
            assertEq(usd.balanceOf(users[i]), start[i]);
            assertEq(reputation.scoreOf(users[i], address(usd)), 10);
            RodaReputation.Record memory rec = reputation.recordOf(users[i], address(usd));
            assertEq(rec.cleanCircles, 1);
            assertEq(rec.volume, 5 * C);
        }
        assertEq(usd.balanceOf(address(circle)), 0);
    }

    function test_contribute_guards() public {
        RodaCircle circle = _started(3, C);
        vm.prank(users[5]);
        vm.expectRevert(RodaCircle.NotMember.selector);
        circle.contribute(0);

        vm.startPrank(users[0]);
        circle.contribute(0);
        vm.expectRevert(RodaCircle.AlreadyPaid.selector);
        circle.contribute(0);
        vm.stopPrank();

        vm.expectRevert(RodaCircle.RoundOpen.selector);
        circle.settle();
    }

    function test_bid_winnerTakesPotMinusDiscount_othersShareIt() public {
        RodaCircle circle = _started(4, C);
        _payAll(circle);

        vm.prank(users[3]);
        circle.bid(30e6);
        vm.prank(users[2]);
        vm.expectRevert(RodaCircle.BidTooLow.selector);
        circle.bid(30e6);
        vm.prank(users[2]);
        circle.bid(60e6);
        vm.prank(users[3]);
        vm.expectRevert(RodaCircle.BidTooHigh.selector);
        circle.bid(201e6);

        _settle(circle);
        assertEq(circle.memberInfo(users[2]).claimable, 340e6);
        assertTrue(circle.memberInfo(users[2]).received);
        assertEq(circle.memberInfo(users[0]).claimable, 20e6);
        assertEq(circle.memberInfo(users[1]).claimable, 20e6);
        assertEq(circle.memberInfo(users[3]).claimable, 20e6);
        assertEq(circle.highestBidder(), address(0));

        // a member who already took the pot cannot bid again
        _payAll(circle);
        vm.prank(users[2]);
        vm.expectRevert(RodaCircle.NotEligible.selector);
        circle.bid(1);
    }

    function test_bid_requiresPaidRoundAndOpenWindow() public {
        RodaCircle circle = _started(3, C);
        vm.prank(users[0]);
        vm.expectRevert(RodaCircle.NotEligible.selector);
        circle.bid(1e6);

        _pay(circle, users[0]);
        vm.warp(circle.roundDeadline());
        vm.prank(users[0]);
        vm.expectRevert(RodaCircle.RoundClosed.selector);
        circle.bid(1e6);
    }

    function test_missedPayment_isCoveredByDeposit() public {
        RodaCircle circle = _started(3, 2 * C);
        _pay(circle, users[0]);
        _pay(circle, users[1]);
        _settle(circle);

        RodaCircle.Member memory late = circle.memberInfo(users[2]);
        assertEq(late.deposit, C);
        assertEq(late.debt, 0);
        assertEq(late.lateRounds, 1);
        assertEq(circle.memberInfo(users[0]).claimable, 3 * C, "pot is still full");

        _payAll(circle);
        _settle(circle);
        _payAll(circle);
        _settle(circle);
        assertEq(reputation.scoreOf(users[2], address(usd)), 4);
        assertEq(reputation.scoreOf(users[0], address(usd)), 10);
    }

    function test_default_afterTakingPot_shrinksLaterPotsAndIsRecorded() public {
        RodaCircle circle = _started(3, C);
        _payAll(circle);
        _settle(circle); // users[0] takes 300

        // users[0] stops paying: round 1 is covered by the deposit, round 2 becomes debt
        _pay(circle, users[1]);
        _pay(circle, users[2]);
        _settle(circle);
        assertEq(circle.memberInfo(users[1]).claimable, 3 * C);

        _pay(circle, users[1]);
        _pay(circle, users[2]);
        _settle(circle);
        assertEq(circle.memberInfo(users[0]).debt, C);
        assertEq(circle.memberInfo(users[2]).claimable, 2 * C + C, "short pot plus own deposit back");

        assertEq(reputation.scoreOf(users[0], address(usd)), 0);
        assertEq(reputation.recordOf(users[0], address(usd)).defaults, 1);
        assertEq(usd.balanceOf(address(circle)), _accounted(circle));

        // a defaulter cannot join a circle that asks for history
        RodaCircle gated = _create(3, C, 1);
        vm.prank(users[0]);
        vm.expectRevert(RodaCircle.ScoreTooLow.selector);
        gated.join();
        vm.prank(users[1]);
        gated.join();
    }

    function test_debtBeforeTakingPot_isNettedFromPayout() public {
        RodaCircle circle = _started(3, C);
        // users[2] never pays: deposit covers round 0, then debt in round 1
        for (uint256 r; r < 2; ++r) {
            _pay(circle, users[0]);
            _pay(circle, users[1]);
            _settle(circle);
        }
        assertEq(circle.memberInfo(users[2]).debt, C);
        assertEq(circle.memberInfo(users[1]).claimable, 2 * C, "round 1 pot was short");

        vm.prank(users[2]);
        vm.expectRevert(RodaCircle.NotEligible.selector);
        circle.bid(1e6);

        _payAll(circle);
        _settle(circle);
        RodaCircle.Member memory m = circle.memberInfo(users[2]);
        assertEq(m.debt, 0);
        assertEq(m.claimable, 2 * C, "300 pot minus 100 debt");
        // the netted 100 is shared by the two members in good standing
        assertEq(circle.memberInfo(users[1]).claimable, 2 * C + 50e6 + C);
        assertEq(usd.balanceOf(address(circle)), _accounted(circle));
    }

    function test_repay_clearsDebtAndPaysCreditors() public {
        RodaCircle circle = _started(3, C);
        _payAll(circle);
        _settle(circle);
        for (uint256 r; r < 2; ++r) {
            _pay(circle, users[1]);
            _pay(circle, users[2]);
            _settle(circle);
        }
        assertEq(circle.memberInfo(users[0]).debt, C);
        uint256 before1 = circle.memberInfo(users[1]).claimable;

        vm.prank(users[1]);
        vm.expectRevert(RodaCircle.NothingOwed.selector);
        circle.repay(1);

        vm.prank(users[0]);
        circle.repay(type(uint256).max);
        assertEq(circle.memberInfo(users[0]).debt, 0);
        assertEq(circle.memberInfo(users[1]).claimable, before1 + 50e6);
        assertEq(usd.balanceOf(address(circle)), _accounted(circle));
    }

    function test_withdraw_revertsWhenEmpty() public {
        RodaCircle circle = _started(3, C);
        vm.prank(users[0]);
        vm.expectRevert(RodaCircle.NothingToWithdraw.selector);
        circle.withdraw();
    }

    function test_nobodyPays_circleStillTerminatesAndBalances() public {
        RodaCircle circle = _started(3, C);
        for (uint256 r; r < 3; ++r) {
            _settle(circle);
        }
        assertEq(uint256(circle.status()), uint256(RodaCircle.Status.Completed));
        assertEq(usd.balanceOf(address(circle)), _accounted(circle));
        for (uint256 i; i < 3; ++i) {
            assertEq(reputation.scoreOf(users[i], address(usd)), 0);
        }
    }

    function test_contribute_revertsWhenRoundMovedOn() public {
        RodaCircle circle = _started(3, C);
        _pay(circle, users[1]);
        _settle(circle);

        // users[0] meant to pay round 0, but it was settled first
        vm.prank(users[0]);
        vm.expectRevert(RodaCircle.WrongRound.selector);
        circle.contribute(0);
    }

    function test_lastWinnerInDebt_doesNotGetItsRepaymentBack() public {
        RodaCircle circle = _started(3, C);
        _settle(circle); // deposits cover round 0
        _settle(circle); // round 1: everyone now owes
        _pay(circle, users[0]);
        _settle(circle); // users[2] takes the last pot while owing 2 rounds, and every other member owes too

        assertEq(uint256(circle.status()), uint256(RodaCircle.Status.Completed));
        assertTrue(circle.memberInfo(users[2]).received);
        assertEq(circle.memberInfo(users[2]).debt, C, "the pot paid off one of the two rounds owed");
        // the netted amount had no creditor in good standing: it is shared by all, not handed back to the winner
        assertEq(circle.memberInfo(users[1]).claimable, C / 3);
        assertLe(circle.memberInfo(users[2]).claimable, C / 3 + 2);
        assertEq(reputation.recordOf(users[2], address(usd)).defaults, 1);
        assertEq(usd.balanceOf(address(circle)), _accounted(circle));
    }

    function test_reputation_isPerToken() public {
        RodaCircle circle = _started(3, C);
        for (uint256 r; r < 3; ++r) {
            _payAll(circle);
            _settle(circle);
        }
        assertEq(reputation.scoreOf(users[0], address(usd)), 10);

        TestDollar other = new TestDollar();
        vm.prank(owner);
        factory.setTokenAllowed(address(other), true);
        assertEq(reputation.scoreOf(users[0], address(other)), 0);

        RodaCircle.Config memory c = _config(3, C, 10);
        c.token = address(other);
        RodaCircle gated = RodaCircle(factory.createCircle(c));
        deal(address(other), users[0], C);
        vm.startPrank(users[0]);
        other.approve(address(gated), C);
        vm.expectRevert(RodaCircle.ScoreTooLow.selector);
        gated.join();
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- fuzz

    /// Any mix of payers and bids: the circle ends after `size` rounds, stays solvent after every
    /// round, pays out its whole balance, and is zero-sum across members.
    function testFuzz_circleIsSolventAndZeroSum(uint8 sizeSeed, uint8 depositSeed, uint256 paySeed, uint256 bidSeed)
        public
    {
        uint256 size = bound(sizeSeed, 3, 12);
        uint256 deposit = C * bound(depositSeed, 1, 3);
        RodaCircle circle = _started(size, deposit);

        uint256[] memory start = new uint256[](size);
        for (uint256 i; i < size; ++i) {
            start[i] = usd.balanceOf(users[i]) + deposit;
        }

        for (uint256 r; r < size; ++r) {
            for (uint256 i; i < size; ++i) {
                bool pays = i == 0 || uint256(keccak256(abi.encode(paySeed, r, i))) % 4 != 0;
                if (pays) {
                    _pay(circle, users[i]);
                }
                uint256 b = uint256(keccak256(abi.encode(bidSeed, r, i))) % (circle.maxBid() * 2);
                vm.prank(users[i]);
                try circle.bid(b) {} catch {}
            }
            _settle(circle);
            assertEq(usd.balanceOf(address(circle)), _accounted(circle), "solvent");
        }
        assertEq(uint256(circle.status()), uint256(RodaCircle.Status.Completed));

        uint256 received;
        for (uint256 i; i < size; ++i) {
            RodaCircle.Member memory m = circle.memberInfo(users[i]);
            assertTrue(m.received);
            assertEq(m.deposit, 0);
            if (m.claimable != 0) {
                vm.prank(users[i]);
                circle.withdraw();
            }
            if (m.received) ++received;
            assertEq(reputation.recordOf(users[i], address(usd)).defaults == 1, m.debt != 0);
        }
        assertEq(received, size);
        assertEq(usd.balanceOf(address(circle)), 0, "fully paid out");

        uint256 totalAfter;
        uint256 totalBefore;
        for (uint256 i; i < size; ++i) {
            totalAfter += usd.balanceOf(users[i]);
            totalBefore += start[i];
        }
        assertEq(totalAfter, totalBefore, "zero sum");
    }

    function testFuzz_bidDiscountNeverExceedsHalfThePot(uint256 bidAmount, uint8 payers) public {
        RodaCircle circle = _started(6, C);
        uint256 n = bound(payers, 1, 6);
        for (uint256 i; i < n; ++i) {
            _pay(circle, users[i]);
        }
        bidAmount = bound(bidAmount, 1, circle.maxBid());
        vm.prank(users[0]);
        circle.bid(bidAmount);
        _settle(circle);
        uint256 pot = 6 * C; // deposits cover the non-payers
        assertGe(circle.memberInfo(users[0]).claimable, pot / 2);
        assertEq(usd.balanceOf(address(circle)), _accounted(circle));
    }
}
