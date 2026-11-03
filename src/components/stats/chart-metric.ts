// What the daily chart measures. Outside the client chart module so server
// pages can pass it: client modules export references, not enum values.
export enum ChartMetric {
  Cost = "cost",
  Tokens = "tokens",
}
