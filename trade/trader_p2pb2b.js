const P2PB2B = require('./api/p2pb2b_api');
const utils = require('../helpers/utils');

// API endpoints:
// https://api.p2pb2b.io
const apiServer = 'https://api.p2pb2b.io';
const exchangeName = 'P2PB2B';
let gettingMarkets = false;

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {

  P2PB2B.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  let markets;
  if (!markets && !gettingMarkets) {
    getMarkets();
  }

  function getMarkets() {
    gettingMarkets = true;
    if (module.exports.markets) {
      return module.exports.markets;
    }
    return new Promise((resolve, reject) => {
      P2PB2B.markets().then(function(data) {
        try {
          let markets = data.result;
          if (!markets) {
            markets = {};
          }
          const result = {};
          Object.keys(markets).forEach((market) => {
            const pairFormatted = `${markets[market].stock.toUpperCase()}/${markets[market].money.toUpperCase()}`;
            result[pairFormatted] = {
              pairPlain: markets[market].name,
              coin1: markets[market].stock.toUpperCase(),
              coin2: markets[market].money.toUpperCase(),
              coin1Decimals: Number(markets[market].precision.stock),
              coin2Decimals: Number(markets[market].precision.money),
              // If the limit is 0, then this limit does not apply to this market
              coin1Precision: Number(markets[market].limits.step_size), // ~ if !== 0, utils.getPrecision(3) = 0.001
              coin2Precision: Number(markets[market].limits.tick_size),
              coin1MinAmount: Number(markets[market].limits.min_amount),
              coin1MaxAmount: Number(markets[market].limits.max_amount),
              coin2MinPrice: Number(markets[market].limits.min_price),
              coin2MaxPrice: Number(markets[market].limits.max_price),
              minTrade: Number(markets[market].limits.min_total), // in coin2
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.markets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }
          resolve(result);
        } catch (e) {
          resolve(false);
          log.warn('Error while processing getMarkets() request: ' + e);
        };
      }).catch((err) => {
        log.warn(`API request getMarkets() of ${utils.getModuleName(module.id)} module failed. ${err}`);
        resolve(undefined);
      }).finally(() => {
        gettingMarkets = false;
      });
    });
  }

  return {
    get markets() {
      return module.exports.markets;
    },
    marketInfo(pair) {
      return module.exports.markets[pair];
    },
    features() {
      return {
        markets: true,
        depositAddress: true,
      };
    },
    getBalances(nonzero = true) {
      return new Promise((resolve, reject) => {
        P2PB2B.getUserAssets().then(function(data) {
          try {
            let assets = data.data.info;
            if (!assets) {
              assets = [];
            }
            let result = [];
            assets.forEach((crypto) => {
              result.push({
                code: crypto.name.toUpperCase(),
                free: +crypto.over,
                freezed: +crypto.lock,
                total: +crypto.num,
                btc: +crypto.btc,
                usd: +crypto.usd,
              });
            });
            if (nonzero) {
              result = result.filter((crypto) => crypto.free || crypto.freezed);
            }
            resolve(result);
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getBalances() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getBalances(nonzero: ${nonzero}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    async getOpenOrders(pair) {

      let allOrders = [];
      let ordersInfo;
      let page = 1;

      do {

        ordersInfo = await this.getOpenOrdersPage(pair, page);
        allOrders = allOrders.concat(ordersInfo.result);
        page += 1;

      } while (ordersInfo.pageInfo.current_page < ordersInfo.pageInfo.page_count);

      return allOrders;

    },
    getOpenOrdersPage(pair, page = 1) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        P2PB2B.getUserNowEntrustSheet(pair_.coin1, pair_.coin2, null, page).then(function(data) {
          try {
            let openOrders = data.data.data;
            const pageInfo = data.data.pageInfo;

            if (!openOrders) {
              openOrders = [];
            }

            const result = [];
            openOrders.forEach((order) => {
              let orderStatus;
              switch (order.status) {
                case 0:
                  orderStatus = 'new';
                  break;
                case 3:
                  orderStatus = 'closed';
                  break;
                case 2:
                  orderStatus = 'filled';
                  break;
                case 1:
                  orderStatus = 'part_filled';
                  break;
                default:
                  break;
              }
              result.push({
                orderid: order.id.toString(),
                symbol: order.coinFrom + '_' + order.coinTo,
                price: +order.price,
                side: order.flag,
                type: 1, // limit
                timestamp: order.created,
                amount: +order.number,
                amountExecuted: +order.numberDeal,
                amountLeft: +order.numberOver,
                status: orderStatus,
                uid: order.uid.toString(),
                coin2Amount: +order.total,
                coinFrom: order.coinFrom,
                coinTo: order.coinTo,
              });
            });

            resolve({ result, pageInfo });

          } catch (e) {
            resolve(false);
            log.warn('Error while processing getOpenOrders() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getOpenOrders(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    cancelOrder(orderId) {
      return new Promise((resolve, reject) => {
        P2PB2B.cancelEntrustSheet(orderId).then(function(data) {
          try {
            if (data.data) {
              log.info(`Cancelling order ${orderId}…`);
              resolve(true);
            } else {
              log.info(`Order ${orderId} not found. Unable to cancel it.`);
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing cancelOrder() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request ${arguments.callee.name}(orderId: ${orderId}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    getRates(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        P2PB2B.ticker(pair_.pair).then(function(data) {
          try {
            data = data.data;
            if (data) {
              resolve({
                ask: +data.askPrice,
                bid: +data.bidPrice,
                volume: +data.volume,
                volume_Coin2: +data.quoteVolume,
                high: +data.high,
                low: +data.low,
                askQty: +data.askQty,
                bidQty: +data.bidQty,
                dealCount: +data.dealCount,
                coin1Decimals: +data.numberPrecision,
                coin2Decimals: +data.pricePrecision,
                firstId: data.firstId,
                lastId: data.lastId,
              });
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getRates() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getRates(pair: ${pair_.pair}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount, pairObj) {

      pair = pair.toUpperCase();
      const pair_ = formatPairName(pair);
      let output = '';
      let message;
      const order = {};

      const type = (orderType === 'sell') ? 2 : 1;

      if (!this.marketInfo(pair)) {
        log.warn(`Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}.`);
        return undefined;
      }

      if (coin1Amount) {
        coin1Amount = (+coin1Amount).toFixed(this.marketInfo(pair).coin1Decimals);
      }
      if (coin2Amount) {
        coin2Amount = (+coin2Amount).toFixed(this.marketInfo(pair).coin2Decimals);
      }
      if (price) {
        price = (+price).toFixed(this.marketInfo(pair).coin2Decimals);
      }

      if (limit) { // Limit order
        output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at ${price} ${pair_.coin2.toUpperCase()}.`;

        return new Promise((resolve, reject) => {
          P2PB2B.addEntrustSheet(pair_.pair, coin1Amount, price, type).then(function(data) {
            try {
              const result = data.data;
              if (result) {
                message = `Order placed to ${output} Order Id: ${result.id.toString()}.`;
                log.info(message);
                order.orderid = result.id.toString();
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances.`;
                log.warn(message);
                order.orderid = false;
                order.message = message;
                resolve(order);
              }
            } catch (e) {
              message = 'Error while processing placeOrder() request: ' + e;
              log.warn(message);
              order.orderid = false;
              order.message = message;
              resolve(order);
            };
          }).catch((err) => {
            log.warn(`API request BITZ.addEntrustSheet-limit(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, price: ${price}, type: ${type}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
            resolve(undefined);
          });
        });

      } else { // Market order
        let size = 0;
        if (orderType === 'sell') {
          if (coin1Amount) {
            size = coin1Amount;
            output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market.`;
          } else {
            message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin1.toUpperCase()} amount.`;
            log.warn(message);
            order.orderid = false;
            order.message = message;
            return order;
          }
        } else { // buy
          if (coin2Amount) {
            size = coin2Amount;
            output = `${orderType} ${pair_.coin1} for ${coin2Amount} ${pair_.coin2.toUpperCase()} at Market Price on ${pair} market.`;
          } else {
            message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} for ${pair_.coin2.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin2.toUpperCase()} amount.`;
            log.warn(message);
            order.orderid = false;
            order.message = message;
            return order;
          }
        }

        return new Promise((resolve, reject) => {
          P2PB2B.addMarketOrder(pair_.pair, size, type).then(function(data) {
            try {
              const result = data.data;
              if (result) {
                message = `Order placed to ${output} Order Id: ${result.id.toString()}.`;
                log.info(message);
                order.orderid = result.id.toString();
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances.`;
                log.warn(message);
                order.orderid = false;
                order.message = message;
                resolve(order);
              }
            } catch (e) {
              message = 'Error while processing placeOrder() request: ' + e;
              log.warn(message);
              order.orderid = false;
              order.message = message;
              resolve(order);
            };
          }).catch((err) => {
            log.warn(`API request BITZ.addEntrustSheet-market(pair: ${pair_.pair}, size: ${size}, type: ${type}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
            resolve(undefined);
          }); ;
        });
      }
    }, // placeOrder()
    getOrderBook(pair) {
      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        P2PB2B.orderBook(pair_.pair).then(function(data) {
          try {
            let book = data.data;
            if (!book) {
              book = [];
            }
            const result = {
              bids: new Array(),
              asks: new Array(),
            };
            book.asks.forEach((crypto) => { // ["0.0108","6991.7021","75.5103"]
              result.asks.push({
                amount: +crypto[1],
                price: +crypto[0],
                count: 1,
                type: 'ask-sell-right',
              });
            });
            result.asks.sort(function(a, b) {
              return parseFloat(a.price) - parseFloat(b.price);
            });
            book.bids.forEach((crypto) => {
              result.bids.push({
                amount: +crypto[1],
                price: +crypto[0],
                count: 1,
                type: 'bid-buy-left',
              });
            });
            result.bids.sort(function(a, b) {
              return parseFloat(b.price) - parseFloat(a.price);
            });
            resolve(result);
          } catch (e) {
            resolve(false);
            log.warn('Error while processing orderBook() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getOrderBook(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    getDepositAddress(coin) {
      return new Promise((resolve, reject) => {
        P2PB2B.getDepositAddress(coin).then(function(data) {
          try {
            const address = data.data.wallet;
            if (address) {
              resolve(address);
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getDepositAddress() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request ${arguments.callee.name}(coin: ${coin}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
  };
};

function formatPairName(pair) {
  if (pair.indexOf('-') > -1) {
    pair = pair.replace('-', '_').toLowerCase();
  } else {
    pair = pair.replace('/', '_').toLowerCase();
  }
  const [coin1, coin2] = pair.split('_');
  return {
    pair,
    coin1: coin1.toLowerCase(),
    coin2: coin2.toLowerCase(),
  };
}

function deformatPairName(pair) {
  const [coin1, coin2] = pair.split('_');
  pair = `${coin1}/${coin2}`;
  return {
    pair: pair.toUpperCase(),
    coin1: coin1.toUpperCase(),
    coin2: coin2.toUpperCase(),
  };
}