// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SealBatch} from "../src/SealBatch.sol";

contract SealBatchTest is Test {
    SealBatch sb;
    uint256 constant W = 4;
    uint256 constant T = 3;
    uint256 constant BOND = 1e18;
    uint256 constant FEE = 5;

    struct O {
        address who;
        bool isBuy;
        uint128 qty;
        uint8 tick;
    }

    function setUp() public {
        sb = new SealBatch(W, T, BOND, FEE);
    }

    // ───── helpers ─────
    function _user(uint256 i) internal returns (address u) {
        u = address(uint160(0x1000 + i));
        vm.warp(block.timestamp + 1000); // 避开水龙头冷却
        vm.prank(u);
        sb.onboard(address(0));
    }

    function _toWindow(uint256 w) internal {
        vm.roll(sb.genesisBlock() + w * W);
    }

    function _salt(address u, uint256 k) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", u, k));
    }

    function _commit(uint256 k, O memory o) internal {
        bytes32 h = sb.commitHashOf(k, o.who, o.isBuy, o.qty, o.tick, _salt(o.who, k));
        vm.prank(o.who);
        sb.commit(o.who, k, h);
    }

    function _reveal(uint256 k, O memory o) internal {
        vm.prank(o.who);
        sb.reveal(o.who, k, o.isBuy, o.qty, o.tick, _salt(o.who, k));
    }

    /// 在批次 k 跑完整一轮：提交 → 揭示（按给定顺序）→ 结算
    function _round(uint256 k, O[] memory os, uint256 revealCount) internal {
        _toWindow(k);
        for (uint256 i = 0; i < os.length; i++) _commit(k, os[i]);
        _toWindow(k + 1);
        for (uint256 i = 0; i < revealCount; i++) _reveal(k, os[i]);
        _toWindow(k + 2);
        sb.settle(k);
    }

    // ───── 正常成交：PRD 示例（价格映射到档位 ticks 18/20/22） ─────
    function test_simpleCross() public {
        O[] memory os = new O[](4);
        os[0] = O(_user(1), true, 2e18, 22); // 甲 买 2 @101
        os[1] = O(_user(2), true, 1e18, 20); // 乙 买 1 @100
        os[2] = O(_user(3), false, 2e18, 18); // 丙 卖 2 @99
        os[3] = O(_user(4), false, 1e18, 20); // 丁 卖 1 @100
        _round(0, os, 4);
        SealBatch.Batch memory b = sb.getBatch(0);
        assertEq(b.priceTick, 20);
        assertEq(b.volume, 3e18);
        assertEq(b.rationedSide, 0);
        // 甲：付 2×100 = 200，退回 1000-1-... 检查价格边界
        (uint256 bo, uint256 qo) = sb.previewClaim(0, os[0].who);
        assertEq(bo, 10e18 + 2e18 * (10_000 - FEE) / 10_000);
        assertEq(qo, 1000e18 - 200e18);
        sb.claim(os[0].who, 0);
        assertEq(sb.freeQuote(os[0].who), 800e18);
    }

    function test_buyRationed() public {
        O[] memory os = new O[](3);
        os[0] = O(_user(1), true, 2e18, 24);
        os[1] = O(_user(2), true, 2e18, 20);
        os[2] = O(_user(3), false, 3e18, 18);
        _round(0, os, 3);
        SealBatch.Batch memory b = sb.getBatch(0);
        // 候选 18,20,24: V(18)=min(4,3)=3, V(20)=min(4,3)=3, V(24)=min(2,3)=2 → 并列 18,20 取较低 18
        assertEq(b.priceTick, 18);
        assertEq(b.volume, 3e18);
        assertEq(b.rationedSide, 1);
        assertEq(b.marginalTick, 20);
        assertEq(sb.fillOf(0, os[0].who), 2e18);
        assertEq(sb.fillOf(0, os[1].who), 1e18);
        assertEq(sb.fillOf(0, os[2].who), 3e18);
    }

    function test_sellRationed() public {
        O[] memory os = new O[](3);
        os[0] = O(_user(1), false, 2e18, 16);
        os[1] = O(_user(2), false, 2e18, 20);
        os[2] = O(_user(3), true, 3e18, 22);
        _round(0, os, 3);
        SealBatch.Batch memory b = sb.getBatch(0);
        assertEq(b.volume, 3e18);
        assertEq(b.rationedSide, 2);
        assertEq(b.marginalTick, 20);
        assertEq(sb.fillOf(0, os[0].who), 2e18);
        assertEq(sb.fillOf(0, os[1].who), 1e18);
        assertEq(sb.fillOf(0, os[2].who), 3e18);
    }

    function test_noCross_refundsAll() public {
        O[] memory os = new O[](2);
        os[0] = O(_user(1), true, 1e18, 10);
        os[1] = O(_user(2), false, 1e18, 30);
        _round(0, os, 2);
        assertEq(sb.getBatch(0).volume, 0);
        sb.claim(os[0].who, 0);
        sb.claim(os[1].who, 0);
        assertEq(sb.freeQuote(os[0].who), 1000e18);
        assertEq(sb.freeBase(os[1].who), 10e18);
    }

    function test_tieMedian() public {
        // 买 1@30, 卖 1@10 → 候选 10,30 V 都是 1 → 偶数取较低 = 10
        O[] memory os = new O[](3);
        os[0] = O(_user(1), true, 1e18, 30);
        os[1] = O(_user(2), false, 1e18, 10);
        os[2] = O(_user(3), false, 1e18, 35); // 不成交，但作为候选价 V(35)=min(0,2)=0
        _round(0, os, 3);
        assertEq(sb.getBatch(0).priceTick, 10);
    }

    // ───── 顺序无关：同一组订单，打乱提交/揭示顺序，结果完全一致 ─────
    function testFuzz_orderIndependence(uint256 seed) public {
        uint256 n = 6;
        O[] memory os = new O[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            os[i] = O(_user(i), r % 2 == 0, uint128(1e15 + (r >> 8) % 5e18), uint8(10 + (r >> 80) % 20));
        }
        _round(0, os, n);
        SealBatch.Batch memory a = sb.getBatch(0);
        uint256[] memory fillsA = new uint256[](n);
        for (uint256 i = 0; i < n; i++) fillsA[i] = sb.fillOf(0, os[i].who);

        // 同样的订单（换一批同样初始余额的新钱包），逆序在批次 3 再来一遍
        O[] memory rev = new O[](n);
        for (uint256 i = 0; i < n; i++) {
            O memory src = os[n - 1 - i];
            rev[i] = O(_user(100 + n - 1 - i), src.isBuy, src.qty, src.tick);
        }
        _round(3, rev, n);
        SealBatch.Batch memory b = sb.getBatch(3);
        assertEq(a.priceTick, b.priceTick);
        assertEq(a.volume, b.volume);
        assertEq(a.rationedSide, b.rationedSide);
        assertEq(a.marginalTick, b.marginalTick);
        assertEq(a.rNum, b.rNum);
        assertEq(a.rDen, b.rDen);
        for (uint256 i = 0; i < n; i++) assertEq(fillsA[i], sb.fillOf(3, address(uint160(0x1000 + 100 + i))));
    }

    // ───── 资产守恒：合约余额 ≥ 所有负债 ─────
    function testFuzz_conservation(uint256 seed) public {
        uint256 n = 7;
        O[] memory os = new O[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i, "c")));
            uint128 qty = uint128(1e15 + (r >> 8) % 9e18);
            uint8 tick = uint8((r >> 80) % 41);
            bool isBuy = r % 2 == 0;
            if (isBuy && uint256(qty) * sb.priceOf(tick) / 1e18 > 990e18) qty = 5e18;
            os[i] = O(_user(i), isBuy, qty, tick);
        }
        uint256 revealN = n - (seed % 3); // 0~2 人弃标
        _round(0, os, revealN);
        uint256 sumBase;
        uint256 sumQuote;
        for (uint256 i = 0; i < n; i++) {
            sb.claim(os[i].who, 0);
            sumBase += sb.freeBase(os[i].who);
            sumQuote += sb.freeQuote(os[i].who);
        }
        assertGe(sb.base().balanceOf(address(sb)), sumBase, "base");
        assertGe(sb.quote().balanceOf(address(sb)), sumQuote, "quote");
        // 限价边界：买方均价 ≤ 限价，卖方 ≥ 限价（扣费前）
        SealBatch.Batch memory b = sb.getBatch(0);
        for (uint256 i = 0; i < revealN; i++) {
            if (sb.fillOf(0, os[i].who) == 0) continue;
            if (os[i].isBuy) assertGe(os[i].tick, b.priceTick);
            else assertLe(os[i].tick, b.priceTick);
        }
    }

    // ───── 弃标：保证金罚没并补偿成交者 ─────
    function test_griefSlashCompensates() public {
        O[] memory os = new O[](3);
        os[0] = O(_user(1), true, 1e18, 20);
        os[1] = O(_user(2), false, 1e18, 20);
        os[2] = O(_user(3), true, 1e18, 25); // 弃标者
        _round(0, os, 2);
        SealBatch.Batch memory b = sb.getBatch(0);
        assertEq(b.slashPool, BOND);
        sb.claim(os[2].who, 0);
        assertEq(sb.freeQuote(os[2].who), 1000e18 - BOND);
        sb.claim(os[0].who, 0);
        // 买方：1000 - 100 + 0.5（罚金一半）
        assertEq(sb.freeQuote(os[0].who), 1000e18 - 100e18 + BOND / 2);
    }

    // ───── 超时：无人结算 → 整轮取消，全额退回 ─────
    function test_timeoutCancel() public {
        address u = _user(1);
        O memory o = O(u, true, 1e18, 20);
        _toWindow(0);
        _commit(0, o);
        _toWindow(1);
        _reveal(0, o);
        _toWindow(2 + T - 1);
        vm.expectRevert(SealBatch.WrongPhase.selector);
        sb.cancel(0);
        _toWindow(2 + T);
        vm.expectRevert(SealBatch.WrongPhase.selector);
        sb.settle(0); // 结算与取消互斥
        sb.cancel(0);
        sb.claim(u, 0);
        assertEq(sb.freeQuote(u), 1000e18);
        assertEq(sb.freeBase(u), 10e18);
    }

    function test_timeoutCancel_grieferStillSlashed() public {
        address u = _user(1);
        O memory o = O(u, true, 1e18, 20);
        _toWindow(0);
        _commit(0, o);
        _toWindow(2 + T);
        sb.cancel(0);
        sb.claim(u, 0);
        assertEq(sb.freeQuote(u), 1000e18 - BOND);
        assertEq(sb.freeBase(u), 10e18);
    }

    // ───── 拒绝：错 salt / 跨批重放 / 重复揭示 / 重复领取 / 阶段越界 / 越权 ─────
    function test_rejects() public {
        address u = _user(1);
        address v = _user(2);
        O memory o = O(u, true, 1e18, 20);
        _toWindow(0);
        _commit(0, o);
        vm.prank(u);
        vm.expectRevert(SealBatch.AlreadyCommitted.selector);
        sb.commit(u, 0, bytes32(uint256(1)));
        // 揭示阶段未到
        vm.prank(u);
        vm.expectRevert(SealBatch.WrongPhase.selector);
        sb.reveal(u, 0, true, 1e18, 20, _salt(u, 0));
        // 别人不能替我下单
        vm.prank(v);
        vm.expectRevert(SealBatch.NotAuthorized.selector);
        sb.commit(u, 0, bytes32(uint256(2)));

        _toWindow(1);
        // 错 salt
        vm.prank(u);
        vm.expectRevert(SealBatch.BadReveal.selector);
        sb.reveal(u, 0, true, 1e18, 20, bytes32(uint256(999)));
        // 改价
        vm.prank(u);
        vm.expectRevert(SealBatch.BadReveal.selector);
        sb.reveal(u, 0, true, 1e18, 19, _salt(u, 0));
        // 提交阶段已过
        vm.prank(v);
        vm.expectRevert(SealBatch.WrongPhase.selector);
        sb.commit(v, 0, bytes32(uint256(3)));
        _reveal(0, o);
        vm.prank(u);
        vm.expectRevert(SealBatch.AlreadyRevealed.selector);
        sb.reveal(u, 0, true, 1e18, 20, _salt(u, 0));

        // 跨批重放：批次 0 的承诺拿到批次 1 揭示
        bytes32 h0 = sb.commitHashOf(0, v, false, 1e18, 20, _salt(v, 0));
        vm.prank(v);
        sb.commit(v, 1, h0);
        _toWindow(2);
        vm.prank(v);
        vm.expectRevert(SealBatch.BadReveal.selector);
        sb.reveal(v, 1, false, 1e18, 20, _salt(v, 0));

        // 未结算不能领
        vm.expectRevert(SealBatch.WrongPhase.selector);
        sb.claim(u, 1);
        sb.settle(0);
        sb.claim(u, 0);
        vm.expectRevert(SealBatch.AlreadyClaimed.selector);
        sb.claim(u, 0);
    }

    function test_lockHidesSide_andLimits() public {
        address u = _user(1);
        // 买单所需 SUSD 超过锁仓 → 揭示被拒（不能虚报）
        O memory o = O(u, true, 20e18, 40); // 20 × 110 = 2200 > 999
        _toWindow(0);
        _commit(0, o);
        // 锁仓时两种币全部锁住，买卖方向不可见
        SealBatch.Order memory ord = sb.getOrder(0, u);
        assertEq(ord.lockedBase, 10e18);
        assertEq(ord.lockedQuote, 1000e18 - BOND);
        assertEq(sb.freeBase(u), 0);
        assertEq(sb.freeQuote(u), 0);
        _toWindow(1);
        vm.prank(u);
        vm.expectRevert(SealBatch.InsufficientLock.selector);
        sb.reveal(u, 0, true, 20e18, 40, _salt(u, 0));
    }

    function test_sessionKey() public {
        address owner = address(0xA11CE);
        address key = address(0xBEEF);
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        sb.onboard{value: 0.2 ether}(key);
        assertEq(key.balance, 0.2 ether);
        assertEq(sb.sessionKey(owner), key);
        O memory o = O(owner, false, 1e18, 20);
        bytes32 h = sb.commitHashOf(0, owner, false, 1e18, 20, _salt(owner, 0));
        _toWindow(0);
        vm.prank(key);
        sb.commit(owner, 0, h);
        _toWindow(1);
        vm.prank(key);
        sb.reveal(owner, 0, false, 1e18, 20, _salt(owner, 0));
        o; // silence
        // 会话密钥不能取款：withdraw 只作用于 msg.sender 自己的余额
        address baseTok = address(sb.base());
        vm.prank(key);
        vm.expectRevert(SealBatch.Insufficient.selector);
        sb.withdraw(baseTok, 1);
    }
}
