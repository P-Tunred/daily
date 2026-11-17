import type { Holding } from "../types";

// Sorted by invested amount descending (largest position first)
export const HOLDINGS: Holding[] = [
  { name: "Apple",               ticker: "AAPL",    invested: 10410   },
  { name: "AI & Big Data Acc",   ticker: "XAIX.DE", invested: 3419    },
  { name: "Berkshire Hathaway",  ticker: "BRK-B",   invested: 1081    },
  { name: "Microsoft",            ticker: "MSFT",    invested: 975     },
  { name: "Siemens Healthineers",ticker: "SHL.DE",  invested: 702     },
  { name: "Silver ETC",          ticker: "PHAG.DE", invested: 295     },
  { name: "Coupang",             ticker: "CPNG",    invested: 207     },
  { name: "DHT Holdings",        ticker: "DHT",     invested: 190     },
  { name: "Hugo Boss",           ticker: "BOSS.DE", invested: 113.33  },
  { name: "Lufthansa",           ticker: "LHA.DE",  invested: 92.78   },
  { name: "India MSCI (Acc)",    ticker: "NDIA.DE", invested: 49      },
];
