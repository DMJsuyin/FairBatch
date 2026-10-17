// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Bounded uniform-price auction. Equal-price marginal orders share pro rata.
library BatchMath {
    struct Input { address owner; bool isBuy; uint256 lots; uint256 limitTicks; }
    struct Result { uint256 volume; uint256 price; uint256 low; uint256 high; uint256[] fills; }

    function clear(Input[] memory orders) internal pure returns (Result memory r) {
        uint256 n = orders.length;
        require(n <= 32, "capacity");
        r.fills = new uint256[](n);
        uint256[] memory buys = new uint256[](n);
        uint256[] memory sells = new uint256[](n);
        uint256 nb; uint256 ns;
        for (uint256 i; i < n; ++i) {
            if (orders[i].lots == 0) continue;
            require(orders[i].lots <= 1e9 && orders[i].limitTicks > 0 && orders[i].limitTicks <= 1e9, "bounds");
            if (orders[i].isBuy) buys[nb++] = i;
            else sells[ns++] = i;
        }
        sort(orders, buys, nb, true);
        sort(orders, sells, ns, false);
        return matchSorted(orders, buys, sells, nb, ns);
    }

    /// @dev Witness carries only order indices, never prices, quantities or fills.
    /// Every nonzero order must occur exactly once on its correct side, in priority order.
    function clearVerified(Input[] memory orders, bytes memory buyIds, bytes memory sellIds) internal pure returns (Result memory) {
        uint256 n = orders.length;
        require(n <= 32 && buyIds.length + sellIds.length <= n, "witness capacity");
        uint256 expected;
        for (uint256 i; i < n; ++i) {
            if (orders[i].lots == 0) continue;
            require(orders[i].lots <= 1e9 && orders[i].limitTicks > 0 && orders[i].limitTicks <= 1e9, "bounds");
            expected |= uint256(1) << i;
        }
        (uint256[] memory buys, uint256 seen) = verifySide(orders, buyIds, true, 0);
        (uint256[] memory sells, uint256 allSeen) = verifySide(orders, sellIds, false, seen);
        require(allSeen == expected, "incomplete witness");
        return matchSorted(orders, buys, sells, buyIds.length, sellIds.length);
    }

    function verifySide(Input[] memory o, bytes memory ids, bool buy, uint256 seen) private pure returns (uint256[] memory sorted, uint256) {
        sorted = new uint256[](ids.length);
        for (uint256 k; k < ids.length; ++k) {
            uint256 id = uint8(ids[k]);
            require(id < o.length && o[id].lots != 0 && o[id].isBuy == buy, "invalid witness index");
            uint256 bit = uint256(1) << id;
            require(seen & bit == 0, "duplicate witness index");
            seen |= bit;
            if (k > 0) require(!better(o[id], o[sorted[k-1]], buy), "unsorted witness");
            sorted[k] = id;
        }
        return (sorted, seen);
    }

    function matchSorted(Input[] memory orders, uint256[] memory buys, uint256[] memory sells, uint256 nb, uint256 ns) private pure returns (Result memory r) {
        r.fills = new uint256[](orders.length);
        uint256 bi; uint256 si; uint256 bUsed; uint256 sUsed;
        while (bi < nb && si < ns) {
            Input memory b = orders[buys[bi]];
            Input memory s = orders[sells[si]];
            if (b.limitTicks < s.limitTicks) break;
            uint256 q = min(b.lots - bUsed, s.lots - sUsed);
            r.volume += q;
            r.low = s.limitTicks;
            r.high = b.limitTicks;
            bUsed += q; sUsed += q;
            if (bUsed == b.lots) { ++bi; bUsed = 0; }
            if (sUsed == s.lots) { ++si; sUsed = 0; }
        }
        if (r.volume == 0) return r;
        r.price = r.low + (r.high - r.low) / 2;
        allocate(orders, buys, nb, r.volume, r.fills);
        allocate(orders, sells, ns, r.volume, r.fills);
    }

    function sort(Input[] memory o, uint256[] memory ids, uint256 n, bool buy) private pure {
        for (uint256 i = 1; i < n; ++i) {
            uint256 id = ids[i]; uint256 j = i;
            while (j > 0 && better(o[id], o[ids[j-1]], buy)) { ids[j] = ids[j-1]; --j; }
            ids[j] = id;
        }
    }
    function better(Input memory a, Input memory b, bool buy) private pure returns (bool) {
        if (a.limitTicks == b.limitTicks) return uint160(a.owner) < uint160(b.owner);
        return buy ? a.limitTicks > b.limitTicks : a.limitTicks < b.limitTicks;
    }
    function allocate(Input[] memory o, uint256[] memory ids, uint256 n, uint256 left, uint256[] memory fills) private pure {
        uint256 start;
        while (start < n && left > 0) {
            uint256 end = start; uint256 total;
            while (end < n && o[ids[end]].limitTicks == o[ids[start]].limitTicks) { total += o[ids[end]].lots; ++end; }
            if (left >= total) {
                for (uint256 k = start; k < end; ++k) fills[ids[k]] = o[ids[k]].lots;
                left -= total;
            } else {
                uint256[] memory remainders = new uint256[](n);
                uint256[] memory heap = new uint256[](end-start);
                uint256 assigned;
                for (uint256 k = start; k < end; ++k) {
                    uint256 product = left * o[ids[k]].lots;
                    fills[ids[k]] = product / total;
                    remainders[k] = product % total;
                    assigned += fills[ids[k]];
                    heap[k-start] = k;
                }
                // Heapify once, then pop the largest remainders: O(k + e log k).
                // Exact remainder ties use addresses, independent of submission order.
                uint256 size = heap.length;
                for (uint256 k = size / 2; k > 0; --k) sift(o, ids, remainders, heap, k-1, size);
                for (uint256 extra = left - assigned; extra > 0; --extra) {
                    ++fills[ids[heap[0]]];
                    heap[0] = heap[--size];
                    if (size > 0) sift(o, ids, remainders, heap, 0, size);
                }
                left = 0;
            }
            start = end;
        }
    }
    function higher(Input[] memory o, uint256[] memory ids, uint256[] memory rem, uint256 a, uint256 b) private pure returns (bool) {
        return rem[a] > rem[b] || (rem[a] == rem[b] && uint160(o[ids[a]].owner) < uint160(o[ids[b]].owner));
    }
    function sift(Input[] memory o, uint256[] memory ids, uint256[] memory rem, uint256[] memory heap, uint256 root, uint256 size) private pure {
        while (root * 2 + 1 < size) {
            uint256 child = root * 2 + 1;
            if (child + 1 < size && higher(o, ids, rem, heap[child+1], heap[child])) ++child;
            if (!higher(o, ids, rem, heap[child], heap[root])) return;
            (heap[root], heap[child]) = (heap[child], heap[root]);
            root = child;
        }
    }
    function min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}
