// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {RodaReputation} from "./RodaReputation.sol";

/// @title RodaCircle
/// @notice A consórcio: `size` members each pay `contribution` every round and one member takes the
///         pot each round, until everyone has taken it once.
/// @dev    Who takes the pot: the highest bidder (the bid is a discount on the pot that is shared
///         among the other members), otherwise the next member in join order.
///         Missed payments: covered from the member's security deposit; once that is spent the
///         shortfall becomes the member's debt, the pot is smaller, and the debt is netted out of
///         any payout the member is still owed. Funds only leave through `withdraw` (pull).
///         Accounting invariant: token balance == deposits + claimable + carry + roundCollected.
contract RodaCircle is Initializable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Status {
        Forming,
        Active,
        Completed,
        Cancelled
    }

    struct Config {
        address token;
        uint256 contribution;
        uint256 size;
        uint256 period;
        uint256 deposit;
        uint256 minScore;
        uint256 joinWindow;
        string name;
    }

    struct Member {
        bool joined;
        bool received;
        uint32 lateRounds;
        uint32 paidThrough; // number of rounds paid: equals round + 1 once the current round is paid
        uint256 deposit;
        uint256 debt;
        uint256 claimable;
        uint256 paidTotal;
    }

    uint256 public constant MIN_SIZE = 3;
    uint256 public constant MAX_SIZE = 20;
    uint256 public constant MIN_PERIOD = 1 minutes;
    uint256 public constant MAX_PERIOD = 90 days;
    uint256 public constant MIN_JOIN_WINDOW = 5 minutes;
    uint256 public constant MAX_JOIN_WINDOW = 60 days;
    uint256 public constant MAX_BID_BPS = 5_000;
    uint256 private constant BPS = 10_000;

    IERC20 public token;
    RodaReputation public reputation;
    address public creator;
    string public name;

    uint256 public contribution;
    uint256 public size;
    uint256 public period;
    uint256 public depositRequired;
    uint256 public minScore;
    uint256 public joinDeadline;

    Status public status;
    uint256 public round;
    uint256 public roundDeadline;
    uint256 public roundCollected;
    uint256 public carry;
    uint256 public highestBid;
    address public highestBidder;

    address[] private _members;
    mapping(address => Member) private _member;

    event Joined(address indexed member, uint256 position);
    event Left(address indexed member);
    event Started(uint256 roundDeadline);
    event Cancelled();
    event Contributed(address indexed member, uint256 indexed round, uint256 amount);
    event BidPlaced(address indexed member, uint256 indexed round, uint256 amount);
    event Missed(address indexed member, uint256 indexed round, uint256 fromDeposit, uint256 newDebt);
    event RoundSettled(
        uint256 indexed round, address indexed winner, uint256 pot, uint256 discount, uint256 debtNetted, uint256 payout
    );
    event Repaid(address indexed member, uint256 amount);
    event Withdrawn(address indexed member, uint256 amount);
    event Completed();

    error InvalidConfig();
    error WrongStatus();
    error AlreadyJoined();
    error NotMember();
    error ScoreTooLow();
    error JoinClosed();
    error JoinStillOpen();
    error AlreadyPaid();
    error RoundOpen();
    error RoundClosed();
    error NotEligible();
    error BidTooLow();
    error BidTooHigh();
    error NothingOwed();
    error NoCreditors();
    error NothingToWithdraw();

    modifier inStatus(Status expected) {
        if (status != expected) revert WrongStatus();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(Config calldata c, RodaReputation reputation_, address creator_) external initializer {
        if (
            c.token == address(0) || c.contribution == 0 || c.size < MIN_SIZE || c.size > MAX_SIZE
                || c.period < MIN_PERIOD || c.period > MAX_PERIOD || c.deposit < c.contribution
                || c.joinWindow < MIN_JOIN_WINDOW || c.joinWindow > MAX_JOIN_WINDOW || bytes(c.name).length == 0
                || bytes(c.name).length > 64
        ) revert InvalidConfig();

        token = IERC20(c.token);
        reputation = reputation_;
        creator = creator_;
        name = c.name;
        contribution = c.contribution;
        size = c.size;
        period = c.period;
        depositRequired = c.deposit;
        minScore = c.minScore;
        joinDeadline = block.timestamp + c.joinWindow;
    }

    // ------------------------------------------------------------------ forming

    /// @notice Take a seat by locking the security deposit. The circle starts when the last seat fills.
    function join() external nonReentrant inStatus(Status.Forming) {
        if (block.timestamp > joinDeadline) revert JoinClosed();
        Member storage m = _member[msg.sender];
        if (m.joined) revert AlreadyJoined();
        if (reputation.scoreOf(msg.sender) < minScore) revert ScoreTooLow();

        m.joined = true;
        m.deposit = depositRequired;
        _members.push(msg.sender);
        emit Joined(msg.sender, _members.length - 1);

        if (_members.length == size) {
            status = Status.Active;
            roundDeadline = block.timestamp + period;
            emit Started(roundDeadline);
        }
        token.safeTransferFrom(msg.sender, address(this), depositRequired);
    }

    /// @notice Give the seat back before the circle starts.
    function leave() external nonReentrant inStatus(Status.Forming) {
        Member storage m = _member[msg.sender];
        if (!m.joined) revert NotMember();
        uint256 refund = m.deposit;
        delete _member[msg.sender];

        uint256 n = _members.length;
        uint256 i;
        while (_members[i] != msg.sender) ++i;
        for (; i + 1 < n; ++i) {
            _members[i] = _members[i + 1];
        }
        _members.pop();

        emit Left(msg.sender);
        token.safeTransfer(msg.sender, refund);
    }

    /// @notice Unlock everyone's deposit if the circle did not fill in time.
    function cancel() external inStatus(Status.Forming) {
        if (block.timestamp <= joinDeadline) revert JoinStillOpen();
        status = Status.Cancelled;
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            Member storage m = _member[_members[i]];
            m.claimable += m.deposit;
            m.deposit = 0;
        }
        emit Cancelled();
    }

    // ------------------------------------------------------------------- active

    /// @notice Pay this round's contribution.
    function contribute() external nonReentrant inStatus(Status.Active) {
        Member storage m = _member[msg.sender];
        if (!m.joined) revert NotMember();
        if (m.paidThrough > round) revert AlreadyPaid();

        m.paidThrough = uint32(round + 1);
        m.paidTotal += contribution;
        roundCollected += contribution;
        emit Contributed(msg.sender, round, contribution);
        token.safeTransferFrom(msg.sender, address(this), contribution);
    }

    /// @notice Offer a discount on the pot to take it this round. Highest offer wins at settlement.
    function bid(uint256 amount) external inStatus(Status.Active) {
        if (block.timestamp >= roundDeadline) revert RoundClosed();
        Member storage m = _member[msg.sender];
        if (!m.joined || m.received || m.debt != 0 || m.paidThrough <= round) revert NotEligible();
        if (amount <= highestBid) revert BidTooLow();
        if (amount > maxBid()) revert BidTooHigh();

        highestBid = amount;
        highestBidder = msg.sender;
        emit BidPlaced(msg.sender, round, amount);
    }

    /// @notice Close the round after its deadline: collect missed payments, pay the pot, open the next round.
    function settle() external nonReentrant inStatus(Status.Active) {
        if (block.timestamp < roundDeadline) revert RoundOpen();

        uint256 n = _members.length;
        uint256 currentRound = round;
        uint256 pot = roundCollected + carry;
        address queued;
        address queuedInDebt;

        for (uint256 i; i < n; ++i) {
            address a = _members[i];
            Member storage m = _member[a];
            if (m.paidThrough <= currentRound) {
                uint256 fromDeposit = m.deposit < contribution ? m.deposit : contribution;
                uint256 unpaid = contribution - fromDeposit;
                m.deposit -= fromDeposit;
                m.debt += unpaid;
                m.paidTotal += fromDeposit;
                m.lateRounds += 1;
                m.paidThrough = uint32(currentRound + 1);
                pot += fromDeposit;
                emit Missed(a, currentRound, fromDeposit, m.debt);
            }
            if (!m.received) {
                if (m.debt == 0) {
                    if (queued == address(0)) queued = a;
                } else if (queuedInDebt == address(0)) {
                    queuedInDebt = a;
                }
            }
        }

        address winner = highestBidder;
        uint256 discount;
        if (winner != address(0)) {
            uint256 cap = (pot * MAX_BID_BPS) / BPS;
            discount = highestBid < cap ? highestBid : cap;
        } else {
            winner = queued != address(0) ? queued : queuedInDebt;
        }

        Member storage w = _member[winner];
        uint256 payout = pot - discount;
        uint256 netted = w.debt < payout ? w.debt : payout;
        w.debt -= netted;
        payout -= netted;
        w.received = true;
        w.claimable += payout;

        roundCollected = 0;
        carry = _distribute(discount + netted, winner);
        highestBid = 0;
        highestBidder = address(0);
        emit RoundSettled(currentRound, winner, pot, discount, netted, payout);

        round = currentRound + 1;
        if (round == size) {
            _complete(w);
        } else {
            roundDeadline = block.timestamp + period;
        }
    }

    /// @notice Pay back debt. The money goes to the members in good standing.
    function repay(uint256 amount) external nonReentrant {
        if (status != Status.Active && status != Status.Completed) revert WrongStatus();
        Member storage m = _member[msg.sender];
        if (m.debt == 0) revert NothingOwed();
        if (amount > m.debt) amount = m.debt;

        m.debt -= amount;
        uint256 left = _distribute(amount, msg.sender);
        if (status == Status.Active) {
            carry += left;
        } else {
            if (left == amount) revert NoCreditors();
            m.claimable += left;
        }
        emit Repaid(msg.sender, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Withdraw everything owed to the caller: payouts, shared discounts, released deposits.
    function withdraw() external nonReentrant {
        Member storage m = _member[msg.sender];
        uint256 amount = m.claimable;
        if (amount == 0) revert NothingToWithdraw();
        m.claimable = 0;
        emit Withdrawn(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    // -------------------------------------------------------------------- views

    function maxBid() public view returns (uint256) {
        return (contribution * size * MAX_BID_BPS) / BPS;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function memberInfo(address account) external view returns (Member memory) {
        return _member[account];
    }

    // ----------------------------------------------------------------- internal

    /// @dev Splits `amount` equally among debt-free members other than `exclude`; returns what was not handed out.
    function _distribute(uint256 amount, address exclude) private returns (uint256 left) {
        if (amount == 0) return 0;
        uint256 n = _members.length;
        uint256 count;
        for (uint256 i; i < n; ++i) {
            address a = _members[i];
            if (a != exclude && _member[a].debt == 0) ++count;
        }
        if (count == 0) return amount;
        uint256 share = amount / count;
        for (uint256 i; i < n; ++i) {
            address a = _members[i];
            if (a != exclude && _member[a].debt == 0) _member[a].claimable += share;
        }
        return amount - share * count;
    }

    function _complete(Member storage lastWinner) private {
        status = Status.Completed;
        lastWinner.claimable += carry;
        carry = 0;

        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            address a = _members[i];
            Member storage m = _member[a];
            m.claimable += m.deposit;
            m.deposit = 0;
            reputation.record(a, m.lateRounds, m.debt != 0, m.paidTotal);
        }
        emit Completed();
    }
}
