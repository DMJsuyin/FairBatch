// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BatchMath.sol";

/// @notice Sealed orders, deterministic on-chain clearing, permissionless recovery.
contract FairBatch is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable base;
    IERC20 public immutable quote;
    uint256 public constant BASE_LOT = 1e16;
    uint256 public constant QUOTE_UNIT = 100;
    uint256 public constant MAX_ORDERS = 32;
    uint256 public constant MAX_VALUE = 1e9;
    bytes32 public constant DOMAIN = keccak256("FairBatch:v0.2");
    uint256 public immutable commitSeconds;
    uint256 public immutable revealSeconds;
    uint256 public immutable settleSeconds;
    uint256 public currentRound;
    uint256 public baseLiability;
    uint256 public quoteLiability;
    enum Phase { None, Commit, Reveal, Ready, Settled, Expired }
    struct Round {
        uint256 commitEnd; uint256 revealEnd; uint256 settleEnd;
        uint256 count; uint256 revealed; uint256 state;
        uint256 volume; uint256 price; uint256 low; uint256 high;
    }
    struct Order {
        address owner; bool isBuy; bool revealed; bool claimed;
        uint256 lots; uint256 limitTicks; bytes32 commitment; uint256 escrow;
        uint256 fillLots; uint256 baseDue; uint256 quoteDue;
    }
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Order[]) private orders;
    mapping(uint256 => mapping(address => uint256)) public indexPlus;
    event RoundOpened(uint256 indexed roundId, uint256 commitEnd, uint256 revealEnd, uint256 settleEnd);
    event Committed(uint256 indexed roundId, address indexed owner, bool isBuy, bytes32 commitment, uint256 escrow);
    event Revealed(uint256 indexed roundId, address indexed owner, uint256 lots, uint256 limitTicks);
    event Settled(uint256 indexed roundId, uint256 volume, uint256 price, uint256 low, uint256 high);
    event Expired(uint256 indexed roundId);
    event Claimed(uint256 indexed roundId, address indexed owner, uint256 baseAmount, uint256 quoteAmount);
    constructor(address b, address q, uint256 c, uint256 r, uint256 s) {
        require(b != address(0) && q != address(0) && b != q && c > 0 && r > 0 && s > 0, "config");
        base = IERC20(b); quote = IERC20(q); commitSeconds = c; revealSeconds = r; settleSeconds = s;
    }
    function phase(uint256 id) public view returns (Phase) {
        Round storage r = rounds[id];
        if (id == 0 || r.commitEnd == 0) return Phase.None;
        if (r.state == 1) return Phase.Settled;
        if (r.state == 2 || block.timestamp >= r.settleEnd) return Phase.Expired;
        if (block.timestamp < r.commitEnd) return Phase.Commit;
        if (block.timestamp < r.revealEnd) return Phase.Reveal;
        return Phase.Ready;
    }
    function openRound() external returns (uint256 id) {
        if (currentRound != 0) {
            Phase p = phase(currentRound);
            require(p == Phase.Settled || p == Phase.Expired, "active round");
            if (p == Phase.Expired) expire(currentRound);
        }
        id = ++currentRound;
        Round storage r = rounds[id];
        r.commitEnd = block.timestamp + commitSeconds;
        r.revealEnd = r.commitEnd + revealSeconds;
        r.settleEnd = r.revealEnd + settleSeconds;
        emit RoundOpened(id, r.commitEnd, r.revealEnd, r.settleEnd);
    }
    function commitmentFor(uint256 id, address owner, bool buy, uint256 lots, uint256 limitTicks, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, block.chainid, address(this), id, owner, buy, lots, limitTicks, salt));
    }
    function commit(uint256 id, bool buy, bytes32 hash, uint256 escrow) external nonReentrant {
        require(phase(id) == Phase.Commit && hash != bytes32(0) && escrow > 0, "commit phase/amount");
        Round storage r = rounds[id];
        require(r.count < MAX_ORDERS && indexPlus[id][msg.sender] == 0, "capacity/duplicate");
        require(escrow <= (buy ? MAX_VALUE * MAX_VALUE * QUOTE_UNIT : MAX_VALUE * BASE_LOT), "escrow bound");
        IERC20 token = buy ? quote : base;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), escrow);
        require(token.balanceOf(address(this)) - beforeBalance == escrow, "exact transfer");
        orders[id].push(Order(msg.sender,buy,false,false,0,0,hash,escrow,0,0,0));
        indexPlus[id][msg.sender] = ++r.count;
        if (buy) quoteLiability += escrow; else baseLiability += escrow;
        emit Committed(id,msg.sender,buy,hash,escrow);
    }
    function revealFor(uint256 id, address owner, uint256 lots, uint256 ticks, bytes32 salt) external {
        require(phase(id) == Phase.Reveal, "reveal phase");
        Order storage o = orderOf(id,owner);
        require(!o.revealed && lots > 0 && lots <= MAX_VALUE && ticks > 0 && ticks <= MAX_VALUE, "reveal bounds");
        require(o.commitment == commitmentFor(id,owner,o.isBuy,lots,ticks,salt), "commitment");
        require(o.escrow == (o.isBuy ? lots * ticks * QUOTE_UNIT : lots * BASE_LOT), "collateral");
        o.revealed = true; o.lots = lots; o.limitTicks = ticks; ++rounds[id].revealed;
        emit Revealed(id,owner,lots,ticks);
    }
    function settle(uint256 id) external {
        require(phase(id) == Phase.Ready, "settle phase");
        BatchMath.Result memory result = BatchMath.clear(inputs(id));
        Round storage r = rounds[id];
        r.state = 1; r.volume = result.volume; r.price = result.price; r.low = result.low; r.high = result.high;
        for (uint256 i; i < orders[id].length; ++i) {
            Order storage o = orders[id][i];
            if (o.claimed) continue;
            o.fillLots = result.fills[i];
            if (o.isBuy) { o.baseDue = o.fillLots * BASE_LOT; o.quoteDue = o.escrow - o.fillLots * r.price * QUOTE_UNIT; }
            else { o.baseDue = o.escrow - o.fillLots * BASE_LOT; o.quoteDue = o.fillLots * r.price * QUOTE_UNIT; }
        }
        emit Settled(id,r.volume,r.price,r.low,r.high);
    }
    function expire(uint256 id) public {
        require(phase(id) == Phase.Expired, "not expired");
        if (rounds[id].state != 2) { rounds[id].state = 2; emit Expired(id); }
    }
    function claimFor(uint256 id, address owner) external nonReentrant { claim(id,owner); }
    function claimMany(uint256 id, address[] calldata owners) external nonReentrant {
        require(owners.length <= MAX_ORDERS,"capacity");
        for(uint256 i; i < owners.length; ++i) claim(id,owners[i]);
    }
    function claim(uint256 id, address owner) private {
        Order storage o = orderOf(id,owner);
        if (o.claimed) return;
        Phase p = phase(id);
        require(p == Phase.Settled || p == Phase.Expired || (p == Phase.Ready && !o.revealed), "not claimable");
        if (p == Phase.Expired) expire(id);
        if (p != Phase.Settled) {
            if (o.isBuy) o.quoteDue = o.escrow; else o.baseDue = o.escrow;
        }
        o.claimed = true;
        baseLiability -= o.baseDue; quoteLiability -= o.quoteDue;
        if(o.baseDue > 0) base.safeTransfer(owner,o.baseDue);
        if(o.quoteDue > 0) quote.safeTransfer(owner,o.quoteDue);
        emit Claimed(id,owner,o.baseDue,o.quoteDue);
    }
    function orderOf(uint256 id,address owner) private view returns(Order storage o) {
        uint256 ix = indexPlus[id][owner]; require(ix != 0,"no order"); return orders[id][ix-1];
    }
    function getOrders(uint256 id) external view returns(Order[] memory) { return orders[id]; }
    function getOrder(uint256 id,address owner) external view returns(Order memory) { return orderOf(id,owner); }
    function previewSettlement(uint256 id) external view returns(BatchMath.Result memory) {
        Phase p=phase(id); require(p==Phase.Ready || p==Phase.Settled,"not closed"); return BatchMath.clear(inputs(id));
    }
    function compute(BatchMath.Input[] memory o) external pure returns(BatchMath.Result memory) { return BatchMath.clear(o); }
    function inputs(uint256 id) private view returns(BatchMath.Input[] memory o) {
        o = new BatchMath.Input[](orders[id].length);
        for(uint256 i; i<o.length;++i) {
            Order storage item=orders[id][i];
            o[i]=BatchMath.Input(item.owner,item.isBuy,item.revealed?item.lots:0,item.limitTicks);
        }
    }
}
