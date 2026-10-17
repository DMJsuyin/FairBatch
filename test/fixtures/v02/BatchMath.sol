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
                bool[] memory awarded = new bool[](n);
                uint256 assigned;
                for (uint256 k = start; k < end; ++k) {
                    uint256 product = left * o[ids[k]].lots;
                    fills[ids[k]] = product / total;
                    remainders[k] = product % total;
                    assigned += fills[ids[k]];
                }
                // At most group-size minus one extra lots. Address breaks exact ties.
                for (uint256 extra = left - assigned; extra > 0; --extra) {
                    uint256 best = type(uint256).max;
                    for (uint256 k = start; k < end; ++k) {
                        if (awarded[k]) continue;
                        if (best == type(uint256).max || remainders[k] > remainders[best] ||
                            (remainders[k] == remainders[best] && uint160(o[ids[k]].owner) < uint160(o[ids[best]].owner))) best = k;
                    }
                    awarded[best] = true; ++fills[ids[best]];
                }
                left = 0;
            }
            start = end;
        }
    }
    function min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}
