// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockToken} from "./MockToken.sol";

/// @title SealBatch — 秒级流水线 · 看不出买卖 · 一次授权的密封集合竞价
/// @notice 一个交易对 (BASE/QUOTE)。每个批次：窗口 k 收承诺，窗口 k+1 揭示，
///         窗口 k+2 起任何人可结算，超时后任何人可整轮取消。结算与取消互斥。
/// @dev 测试网原型，未审计。哈希是承诺不是加密；揭示后订单公开。
contract SealBatch {
    // ───────────────────────── 常量与参数 ─────────────────────────
    uint256 public constant NUM_TICKS = 41; // price(t) = 90 + 0.5·t  (QUOTE / BASE)
    uint256 public constant P0 = 90e18;
    uint256 public constant STEP = 0.5e18;
    uint256 public constant MIN_QTY = 1e15; // 0.001 BASE，保证手续费覆盖舍入尾差
    uint256 public constant BPS = 10_000;

    MockToken public immutable base;
    MockToken public immutable quote;
    uint256 public immutable genesisBlock;
    uint256 public immutable windowBlocks;
    uint256 public immutable timeoutWindows;
    uint256 public immutable bond; // QUOTE，提交时扣，揭示后退，不揭示罚没并补偿本批成交者
    uint256 public immutable feeBps; // 收到资产时按比例扣，留在合约覆盖舍入

    uint256 public constant FAUCET_BASE = 10e18;
    uint256 public constant FAUCET_QUOTE = 1_000e18;
    uint256 public constant FAUCET_COOLDOWN = 600; // 秒

    // ───────────────────────── 状态 ─────────────────────────
    mapping(address => uint256) public freeBase;
    mapping(address => uint256) public freeQuote;
    mapping(address => address) public sessionKey; // owner => key（只能 commit/reveal）
    mapping(address => uint256) public lastFaucet;

    struct Order {
        bytes32 commitHash;
        uint128 lockedBase;
        uint128 lockedQuote; // 不含保证金
        uint128 qty;
        uint8 tick;
        bool isBuy;
        bool revealed;
        bool claimed;
    }

    struct Batch {
        uint32 commits;
        uint32 reveals;
        bool settled;
        bool cancelled;
        uint8 priceTick;
        uint8 rationedSide; // 0 无 / 1 买方按比例 / 2 卖方按比例
        uint8 marginalTick;
        uint128 volume;
        uint128 rNum;
        uint128 rDen;
        uint128 slashPool;
    }

    mapping(uint256 => Batch) internal _batches;
    mapping(uint256 => mapping(address => Order)) internal _orders;
    mapping(uint256 => uint256[NUM_TICKS]) internal _buyAt;
    mapping(uint256 => uint256[NUM_TICKS]) internal _sellAt;

    // ───────────────────────── 事件 ─────────────────────────
    event Deposited(address indexed owner, address indexed token, uint256 amount);
    event Withdrawn(address indexed owner, address indexed token, uint256 amount);
    event SessionKeySet(address indexed owner, address indexed key);
    event Committed(uint256 indexed batchId, address indexed owner, bytes32 commitHash);
    event Revealed(uint256 indexed batchId, address indexed owner, bool isBuy, uint128 qty, uint8 tick);
    event Settled(
        uint256 indexed batchId,
        uint8 priceTick,
        uint128 volume,
        uint8 rationedSide,
        uint8 marginalTick,
        uint128 rNum,
        uint128 rDen,
        uint128 slashPool
    );
    event Cancelled(uint256 indexed batchId);
    event Claimed(uint256 indexed batchId, address indexed owner, uint256 baseOut, uint256 quoteOut);

    error WrongPhase();
    error NotAuthorized();
    error AlreadyCommitted();
    error NoCommit();
    error AlreadyRevealed();
    error BadReveal();
    error InsufficientLock();
    error AlreadyClaimed();
    error Insufficient();
    error Cooldown();

    constructor(uint256 _windowBlocks, uint256 _timeoutWindows, uint256 _bond, uint256 _feeBps) {
        require(_windowBlocks > 0 && _timeoutWindows > 0 && _feeBps > 0 && _feeBps < BPS, "params");
        base = new MockToken("SealBatch Base", "SBA");
        quote = new MockToken("SealBatch USD", "SUSD");
        genesisBlock = block.number;
        windowBlocks = _windowBlocks;
        timeoutWindows = _timeoutWindows;
        bond = _bond;
        feeBps = _feeBps;
    }

    // ───────────────────────── 时间与阶段 ─────────────────────────
    function currentWindow() public view returns (uint256) {
        return (block.number - genesisBlock) / windowBlocks;
    }

    /// @return 0 收承诺 / 1 揭示 / 2 可结算 / 3 可取消 / 4 已结算 / 5 已取消 / 6 未开始
    function phaseOf(uint256 batchId) public view returns (uint8) {
        Batch storage b = _batches[batchId];
        if (b.settled) return 4;
        if (b.cancelled) return 5;
        uint256 w = currentWindow();
        if (w < batchId) return 6;
        if (w == batchId) return 0;
        if (w == batchId + 1) return 1;
        if (w < batchId + 2 + timeoutWindows) return 2;
        return 3;
    }

    function priceOf(uint256 tick) public pure returns (uint256) {
        return P0 + STEP * tick;
    }

    // ───────────────────────── 金库 ─────────────────────────
    /// @notice 一次钱包签名完成入场：领测试币进金库 + 授权会话密钥 + 给会话密钥转 gas
    function onboard(address key) external payable {
        if (block.timestamp < lastFaucet[msg.sender] + FAUCET_COOLDOWN && lastFaucet[msg.sender] != 0) {
            revert Cooldown();
        }
        lastFaucet[msg.sender] = block.timestamp;
        base.mint(address(this), FAUCET_BASE);
        quote.mint(address(this), FAUCET_QUOTE);
        freeBase[msg.sender] += FAUCET_BASE;
        freeQuote[msg.sender] += FAUCET_QUOTE;
        emit Deposited(msg.sender, address(base), FAUCET_BASE);
        emit Deposited(msg.sender, address(quote), FAUCET_QUOTE);
        if (key != address(0)) _setSessionKey(key);
    }

    function setSessionKey(address key) external payable {
        _setSessionKey(key);
    }

    function _setSessionKey(address key) internal {
        sessionKey[msg.sender] = key;
        emit SessionKeySet(msg.sender, key);
        if (msg.value > 0) {
            (bool ok,) = key.call{value: msg.value}("");
            require(ok, "gas forward");
        }
    }

    /// @notice 领测试币到钱包（不进金库），用于走标准 approve + deposit 路径
    function faucetToWallet() external {
        if (block.timestamp < lastFaucet[msg.sender] + FAUCET_COOLDOWN && lastFaucet[msg.sender] != 0) {
            revert Cooldown();
        }
        lastFaucet[msg.sender] = block.timestamp;
        base.mint(msg.sender, FAUCET_BASE);
        quote.mint(msg.sender, FAUCET_QUOTE);
    }

    function deposit(address token, uint256 amount) external {
        _token(token).transferFrom(msg.sender, address(this), amount);
        if (token == address(base)) freeBase[msg.sender] += amount;
        else freeQuote[msg.sender] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice 只有 owner 本人能取款（会话密钥不行），锁在批次里的部分取不出
    function withdraw(address token, uint256 amount) external {
        _token(token);
        if (token == address(base)) {
            if (freeBase[msg.sender] < amount) revert Insufficient();
            freeBase[msg.sender] -= amount;
        } else {
            if (freeQuote[msg.sender] < amount) revert Insufficient();
            freeQuote[msg.sender] -= amount;
        }
        MockToken(token).transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function _token(address token) internal view returns (MockToken) {
        require(token == address(base) || token == address(quote), "token");
        return MockToken(token);
    }

    function _auth(address owner) internal view {
        if (msg.sender != owner && (msg.sender != sessionKey[owner] || msg.sender == address(0))) {
            revert NotAuthorized();
        }
    }

    // ───────────────────────── 承诺与揭示 ─────────────────────────
    function commitHashOf(
        uint256 batchId,
        address owner,
        bool isBuy,
        uint128 qty,
        uint8 tick,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, batchId, owner, isBuy, qty, tick, salt));
    }

    /// @notice 锁住 owner 金库里两种币的全部可用余额 —— 链上看不出买卖方向和数量
    function commit(address owner, uint256 batchId, bytes32 h) external {
        _auth(owner);
        if (phaseOf(batchId) != 0) revert WrongPhase();
        Order storage o = _orders[batchId][owner];
        if (o.commitHash != bytes32(0)) revert AlreadyCommitted();
        uint256 fq = freeQuote[owner];
        if (fq < bond) revert Insufficient();
        uint256 fb = freeBase[owner];
        o.commitHash = h;
        o.lockedBase = uint128(fb);
        o.lockedQuote = uint128(fq - bond);
        freeBase[owner] = 0;
        freeQuote[owner] = 0;
        _batches[batchId].commits += 1;
        emit Committed(batchId, owner, h);
    }

    function reveal(address owner, uint256 batchId, bool isBuy, uint128 qty, uint8 tick, bytes32 salt) external {
        _auth(owner);
        if (phaseOf(batchId) != 1) revert WrongPhase();
        Order storage o = _orders[batchId][owner];
        if (o.commitHash == bytes32(0)) revert NoCommit();
        if (o.revealed) revert AlreadyRevealed();
        if (tick >= NUM_TICKS || qty < MIN_QTY) revert BadReveal();
        if (commitHashOf(batchId, owner, isBuy, qty, tick, salt) != o.commitHash) revert BadReveal();
        if (isBuy) {
            if (_ceilMul(qty, priceOf(tick)) > o.lockedQuote) revert InsufficientLock();
            _buyAt[batchId][tick] += qty;
        } else {
            if (qty > o.lockedBase) revert InsufficientLock();
            _sellAt[batchId][tick] += qty;
        }
        o.revealed = true;
        o.isBuy = isBuy;
        o.qty = qty;
        o.tick = tick;
        _batches[batchId].reveals += 1;
        emit Revealed(batchId, owner, isBuy, qty, tick);
    }

    // ───────────────────────── 清算 ─────────────────────────
    /// @notice 任何人可调用。只扫 41 个档位，与订单数无关。
    function settle(uint256 batchId) external {
        if (phaseOf(batchId) != 2) revert WrongPhase();
        Batch storage b = _batches[batchId];
        uint256[NUM_TICKS] storage buyAt = _buyAt[batchId];
        uint256[NUM_TICKS] storage sellAt = _sellAt[batchId];

        uint256[NUM_TICKS] memory D; // 买价 ≥ t 的买量
        uint256[NUM_TICKS] memory S; // 卖价 ≤ t 的卖量
        uint256 acc;
        for (uint256 i = NUM_TICKS; i > 0; i--) {
            acc += buyAt[i - 1];
            D[i - 1] = acc;
        }
        acc = 0;
        for (uint256 i = 0; i < NUM_TICKS; i++) {
            acc += sellAt[i];
            S[i] = acc;
        }

        // 候选价 = 有揭示订单的去重限价档；取成交量最大者，并列取中位（偶数取较低）
        uint256 maxV;
        uint256 nTie;
        for (uint256 t = 0; t < NUM_TICKS; t++) {
            if (buyAt[t] == 0 && sellAt[t] == 0) continue;
            uint256 v = D[t] < S[t] ? D[t] : S[t];
            if (v > maxV) {
                maxV = v;
                nTie = 1;
            } else if (v == maxV && v > 0) {
                nTie += 1;
            }
        }

        b.settled = true;
        b.slashPool = uint128(uint256(b.commits - b.reveals) * bond);

        if (maxV == 0) {
            emit Settled(batchId, 0, 0, 0, 0, 0, 0, b.slashPool);
            return;
        }

        uint256 target = (nTie - 1) / 2;
        uint256 p;
        uint256 seen;
        for (uint256 t = 0; t < NUM_TICKS; t++) {
            if (buyAt[t] == 0 && sellAt[t] == 0) continue;
            uint256 v = D[t] < S[t] ? D[t] : S[t];
            if (v == maxV) {
                if (seen == target) {
                    p = t;
                    break;
                }
                seen++;
            }
        }

        b.priceTick = uint8(p);
        b.volume = uint128(maxV);

        if (D[p] > S[p]) {
            // 买方过量：从最高买价往下逐档全成，放不下的那一档按比例
            uint256 cum;
            for (uint256 t = NUM_TICKS; t > p; t--) {
                uint256 q = buyAt[t - 1];
                if (cum + q > maxV) {
                    b.rationedSide = 1;
                    b.marginalTick = uint8(t - 1);
                    b.rNum = uint128(maxV - cum);
                    b.rDen = uint128(q);
                    break;
                }
                cum += q;
            }
        } else if (S[p] > D[p]) {
            uint256 cum;
            for (uint256 t = 0; t <= p; t++) {
                uint256 q = sellAt[t];
                if (cum + q > maxV) {
                    b.rationedSide = 2;
                    b.marginalTick = uint8(t);
                    b.rNum = uint128(maxV - cum);
                    b.rDen = uint128(q);
                    break;
                }
                cum += q;
            }
        }

        emit Settled(batchId, b.priceTick, b.volume, b.rationedSide, b.marginalTick, b.rNum, b.rDen, b.slashPool);
    }

    /// @notice 超时仍无人结算：任何人可整轮取消，锁仓全额退回；已揭示者退保证金，弃标者保证金仍罚没
    function cancel(uint256 batchId) external {
        if (phaseOf(batchId) != 3) revert WrongPhase();
        _batches[batchId].cancelled = true;
        emit Cancelled(batchId);
    }

    function fillOf(uint256 batchId, address owner) public view returns (uint256) {
        Batch storage b = _batches[batchId];
        Order storage o = _orders[batchId][owner];
        if (!b.settled || !o.revealed || b.volume == 0) return 0;
        uint256 p = b.priceTick;
        if (o.isBuy) {
            if (o.tick < p) return 0;
            if (b.rationedSide == 1) {
                if (o.tick < b.marginalTick) return 0;
                if (o.tick == b.marginalTick) return uint256(o.qty) * b.rNum / b.rDen;
            }
            return o.qty;
        } else {
            if (o.tick > p) return 0;
            if (b.rationedSide == 2) {
                if (o.tick > b.marginalTick) return 0;
                if (o.tick == b.marginalTick) return uint256(o.qty) * b.rNum / b.rDen;
            }
            return o.qty;
        }
    }

    /// @notice 计算 owner 在该批次可领回金库的 (BASE, QUOTE)
    function previewClaim(uint256 batchId, address owner) public view returns (uint256 baseOut, uint256 quoteOut) {
        Batch storage b = _batches[batchId];
        Order storage o = _orders[batchId][owner];
        if (o.commitHash == bytes32(0)) return (0, 0);
        baseOut = o.lockedBase;
        quoteOut = o.lockedQuote;
        if (b.cancelled) return (baseOut, o.revealed ? quoteOut + bond : quoteOut); // 取消也不放过弃标者
        if (!b.settled) return (0, 0);
        if (!o.revealed) return (baseOut, quoteOut); // 保证金罚没
        quoteOut += bond;
        uint256 fill = fillOf(batchId, owner);
        if (fill == 0) return (baseOut, quoteOut);
        uint256 px = priceOf(b.priceTick);
        if (o.isBuy) {
            quoteOut -= _ceilMul(fill, px);
            baseOut += fill * (BPS - feeBps) / BPS;
        } else {
            baseOut -= fill;
            quoteOut += (fill * px / 1e18) * (BPS - feeBps) / BPS;
        }
        // 罚没池按成交量补偿给本批成交者（两侧合计 2V）
        if (b.slashPool > 0) quoteOut += uint256(b.slashPool) * fill / (2 * uint256(b.volume));
    }

    /// @notice 任何人可代领（keeper 自动领），资产只回到 owner 的金库可用余额
    function claim(address owner, uint256 batchId) external {
        Batch storage b = _batches[batchId];
        if (!b.settled && !b.cancelled) revert WrongPhase();
        Order storage o = _orders[batchId][owner];
        if (o.commitHash == bytes32(0)) revert NoCommit();
        if (o.claimed) revert AlreadyClaimed();
        (uint256 baseOut, uint256 quoteOut) = previewClaim(batchId, owner);
        o.claimed = true;
        freeBase[owner] += baseOut;
        freeQuote[owner] += quoteOut;
        emit Claimed(batchId, owner, baseOut, quoteOut);
    }

    // ───────────────────────── 只读辅助 ─────────────────────────
    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function getOrder(uint256 batchId, address owner) external view returns (Order memory) {
        return _orders[batchId][owner];
    }

    function getBook(uint256 batchId)
        external
        view
        returns (uint256[NUM_TICKS] memory buys, uint256[NUM_TICKS] memory sells)
    {
        return (_buyAt[batchId], _sellAt[batchId]);
    }

    function _ceilMul(uint256 qty, uint256 px) internal pure returns (uint256) {
        return (qty * px + 1e18 - 1) / 1e18;
    }
}
