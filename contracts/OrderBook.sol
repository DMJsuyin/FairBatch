// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Bounded, price-time priority spot CLOB. No owner, upgrades, oracle or privileged matcher.
/// @dev Only exact-transfer, non-rebasing assets. One isolated contract per market.
contract OrderBook is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_ORDERS = 128;
    uint256 public constant MAX_BATCH = 16;
    uint256 public constant MAX_MATCHES = 32;
    uint64 public constant MAX_VALUE = 1_000_000_000;
    IERC20 public immutable baseToken;
    IERC20 public immutable quoteToken;
    uint256 public immutable baseLot;
    uint256 public immutable quoteTick;
    uint256 public nextOrderId = 1;
    uint256 public bestBid;
    uint256 public bestAsk;
    uint256 public activeOrders;
    uint256 public baseLiability;
    uint256 public quoteLiability;
    mapping(address => uint256) public baseFree;
    mapping(address => uint256) public quoteFree;

    struct Order { address owner; bool isBuy; uint64 price; uint64 lots; uint256 prev; uint256 next; }
    struct Request { bool isBuy; uint64 price; uint64 lots; bool postOnly; bool ioc; uint64 minFill; }
    struct Entry { uint256 id; address owner; bool isBuy; uint64 price; uint64 lots; }
    mapping(uint256 => Order) public orders;

    error InvalidRequest(); error InsufficientBalance(); error NotOwner(); error BookFull();
    error SelfTrade(); error WouldCross(); error MatchLimit(); error MinFill(); error UnsupportedToken();
    event Deposited(address indexed trader, bool isBase, uint256 amount);
    event Withdrawn(address indexed trader, bool isBase, uint256 amount);
    event Placed(uint256 indexed id, address indexed trader, bool isBuy, uint64 price, uint64 lots);
    event Cancelled(uint256 indexed id, address indexed trader, uint64 remaining);
    event Trade(uint256 indexed makerId, uint256 indexed takerId, address indexed maker, address taker, bool takerBuy, uint64 price, uint64 lots);

    constructor(address base_, address quote_, uint256 lot_, uint256 tick_) {
        if (base_ == quote_ || base_.code.length == 0 || quote_.code.length == 0 || lot_ == 0 || tick_ == 0 || lot_ > 1e24 || tick_ > 1e24) revert InvalidRequest();
        baseToken = IERC20(base_); quoteToken = IERC20(quote_); baseLot = lot_; quoteTick = tick_;
    }

    function deposit(bool isBase, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidRequest();
        IERC20 token = isBase ? baseToken : quoteToken;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedToken();
        if (isBase) { baseFree[msg.sender] += amount; baseLiability += amount; }
        else { quoteFree[msg.sender] += amount; quoteLiability += amount; }
        emit Deposited(msg.sender, isBase, amount);
    }

    function withdraw(bool isBase, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidRequest();
        if (isBase) {
            if (baseFree[msg.sender] < amount) revert InsufficientBalance();
            baseFree[msg.sender] -= amount; baseLiability -= amount;
        } else {
            if (quoteFree[msg.sender] < amount) revert InsufficientBalance();
            quoteFree[msg.sender] -= amount; quoteLiability -= amount;
        }
        (isBase ? baseToken : quoteToken).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, isBase, amount);
    }

    function placeOrder(Request calldata request) external nonReentrant returns (uint256 id, uint64 filled) {
        return _place(request);
    }
    function batchPlaceOrders(Request[] calldata requests) external nonReentrant {
        _batch(requests);
    }
    function batchCancel(uint256[] calldata ids) external nonReentrant {
        if (ids.length == 0 || ids.length > MAX_BATCH) revert InvalidRequest();
        for (uint256 i; i < ids.length; ++i) _cancel(ids[i]);
    }
    /// @notice Replace an entire grid atomically; failed placement restores cancellations too.
    function replaceOrders(uint256[] calldata ids, Request[] calldata requests) external nonReentrant {
        if (ids.length > MAX_BATCH) revert InvalidRequest();
        for (uint256 i; i < ids.length; ++i) _cancel(ids[i]);
        _batch(requests);
    }
    function cancel(uint256 id) external nonReentrant { _cancel(id); }

    function _batch(Request[] calldata requests) internal {
        if (requests.length == 0 || requests.length > MAX_BATCH) revert InvalidRequest();
        for (uint256 i; i < requests.length; ++i) _place(requests[i]);
    }
    function _place(Request calldata r) internal returns (uint256 id, uint64 filled) {
        if (r.price == 0 || r.price > MAX_VALUE || r.lots == 0 || r.lots > MAX_VALUE || r.minFill > r.lots || (r.postOnly && r.ioc)) revert InvalidRequest();
        uint256 opposite = r.isBuy ? bestAsk : bestBid;
        if (r.postOnly && _crosses(r.isBuy, r.price, opposite)) revert WouldCross();
        uint256 reserved = r.isBuy ? uint256(r.lots) * r.price * quoteTick : uint256(r.lots) * baseLot;
        if (r.isBuy) {
            if (quoteFree[msg.sender] < reserved) revert InsufficientBalance();
            quoteFree[msg.sender] -= reserved;
        } else {
            if (baseFree[msg.sender] < reserved) revert InsufficientBalance();
            baseFree[msg.sender] -= reserved;
        }
        id = nextOrderId++;
        uint64 remaining = r.lots;
        uint256 iterations;
        while (remaining > 0 && _crosses(r.isBuy, r.price, opposite) && iterations < MAX_MATCHES) {
            Order storage maker = orders[opposite];
            if (maker.owner == msg.sender) revert SelfTrade();
            uint64 amount = remaining < maker.lots ? remaining : maker.lots;
            uint256 cost = uint256(amount) * maker.price * quoteTick;
            uint256 base = uint256(amount) * baseLot;
            if (r.isBuy) {
                baseFree[msg.sender] += base;
                quoteFree[maker.owner] += cost;
                quoteFree[msg.sender] += uint256(amount) * (r.price - maker.price) * quoteTick;
            } else {
                quoteFree[msg.sender] += cost;
                baseFree[maker.owner] += base;
            }
            emit Trade(opposite, id, maker.owner, msg.sender, r.isBuy, maker.price, amount);
            remaining -= amount;
            maker.lots -= amount;
            uint256 following = maker.next;
            if (maker.lots == 0) { _unlink(opposite); delete orders[opposite]; opposite = following; }
            ++iterations;
        }
        filled = r.lots - remaining;
        if (filled < r.minFill) revert MinFill();
        if (remaining > 0) {
            if (r.ioc) {
                if (r.isBuy) quoteFree[msg.sender] += uint256(remaining) * r.price * quoteTick;
                else baseFree[msg.sender] += uint256(remaining) * baseLot;
            } else {
                if (_crosses(r.isBuy, r.price, opposite)) revert MatchLimit();
                if (activeOrders >= MAX_ORDERS) revert BookFull();
                orders[id] = Order(msg.sender, r.isBuy, r.price, remaining, 0, 0);
                _insert(id);
                emit Placed(id, msg.sender, r.isBuy, r.price, remaining);
            }
        }
    }
    function _crosses(bool buy, uint64 price, uint256 other) internal view returns (bool) {
        return other != 0 && (buy ? price >= orders[other].price : price <= orders[other].price);
    }
    function _insert(uint256 id) internal {
        Order storage order = orders[id];
        uint256 cursor = order.isBuy ? bestBid : bestAsk;
        uint256 previous;
        // Equal prices are traversed too, preserving FIFO. Bounded by MAX_ORDERS.
        while (cursor != 0 && (order.isBuy ? orders[cursor].price >= order.price : orders[cursor].price <= order.price)) {
            previous = cursor; cursor = orders[cursor].next;
        }
        order.prev = previous; order.next = cursor;
        if (previous != 0) orders[previous].next = id;
        else if (order.isBuy) bestBid = id; else bestAsk = id;
        if (cursor != 0) orders[cursor].prev = id;
        ++activeOrders;
    }
    function _unlink(uint256 id) internal {
        Order storage order = orders[id];
        if (order.prev != 0) orders[order.prev].next = order.next;
        else if (order.isBuy) bestBid = order.next; else bestAsk = order.next;
        if (order.next != 0) orders[order.next].prev = order.prev;
        --activeOrders;
    }
    function _cancel(uint256 id) internal {
        Order memory order = orders[id];
        if (order.owner != msg.sender) revert NotOwner();
        _unlink(id); delete orders[id];
        if (order.isBuy) quoteFree[msg.sender] += uint256(order.lots) * order.price * quoteTick;
        else baseFree[msg.sender] += uint256(order.lots) * baseLot;
        emit Cancelled(id, msg.sender, order.lots);
    }
    function getBook(bool isBuy) external view returns (Entry[] memory entries) {
        entries = new Entry[](activeOrders);
        uint256 id = isBuy ? bestBid : bestAsk;
        uint256 count;
        while (id != 0) {
            Order memory o = orders[id];
            entries[count++] = Entry(id, o.owner, o.isBuy, o.price, o.lots);
            id = o.next;
        }
        assembly ("memory-safe") { mstore(entries, count) }
    }
}
