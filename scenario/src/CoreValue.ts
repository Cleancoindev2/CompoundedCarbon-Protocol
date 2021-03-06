import { Event } from './Event';
import { World } from './World';
import {
  AddressV,
  AnythingV,
  BoolV,
  EventV,
  ExpNumberV,
  ListV,
  MapV,
  NothingV,
  NumberV,
  PercentV,
  PreciseV,
  StringV,
  Value
} from './Value';
import { Arg, Fetcher, getFetcherValue } from './Command';
import { getUserValue, userFetchers } from './Value/UserValue';
import { comptrollerFetchers, getComptrollerValue } from './Value/ComptrollerValue';
import { comptrollerImplFetchers, getComptrollerImplValue } from './Value/ComptrollerImplValue';
import { getUnitrollerValue, unitrollerFetchers } from './Value/UnitrollerValue';
import { cTokenFetchers, getCTokenValue } from './Value/CTokenValue';
import { cTokenDelegateFetchers, getCTokenDelegateValue } from './Value/CTokenDelegateValue';
import { erc20Fetchers, getErc20Value } from './Value/Erc20Value';
import { mcdFetchers, getMCDValue } from './Value/MCDValue';
import { getInterestRateModelValue, interestRateModelFetchers } from './Value/InterestRateModelValue';
import { getPriceOracleValue, priceOracleFetchers } from './Value/PriceOracleValue';
import { getPriceOracleProxyValue, priceOracleProxyFetchers } from './Value/PriceOracleProxyValue';
import { getTimelockValue, timelockFetchers, getTimelockAddress } from './Value/TimelockValue';
import { getMaximillionValue, maximillionFetchers } from './Value/MaximillionValue';
import { getAddress } from './ContractLookup';
import { mustArray } from './Utils';
import { toEncodableNum } from './Encoding';
import { BigNumber } from 'bignumber.js';

const expMantissa = new BigNumber('1000000000000000000');

function getSigFigs(value) {
  let str = value.toString();

  str = str.replace(/e\d+/, ''); // Remove e01
  str = str.replace(/\./, ''); // Remove decimal point

  return str.length;
}

export async function getEventV(world: World, event: Event): Promise<EventV> {
  return new EventV(event);
}

// TODO: We may want to handle simple values -> complex values at the parser level
//       This is currently trying to parse simple values as simple or complex values,
//       and this is because items like `Some` could work either way.
export async function mapValue<T>(
  world: World,
  event: Event,
  simple: (string) => T,
  complex: (World, Event) => Promise<Value>,
  type: any
): Promise<T> {
  let simpleErr;
  let val;

  if (typeof event === 'string') {
    try {
      return simple(<string>event);
    } catch (err) {
      // Collect the error, but fallback to a complex expression
      simpleErr = err;
    }
  }

  try {
    val = await complex(world, event);
  } catch (complexErr) {
    // If we had an error before and this was the fallback, now throw that one
    if (simpleErr) {
      throw simpleErr;
    } else {
      throw complexErr;
    }
  }

  if (!(val instanceof type)) {
    throw new Error(`Expected ${type.name} from ${event.toString()}, got: ${val.toString()}`);
  }

  // We just did a typecheck above...
  return <T>(<unknown>val);
}

export async function getBoolV(world: World, event: Event): Promise<BoolV> {
  return mapValue<BoolV>(
    world,
    event,
    str => {
      const lower = str.trim().toLowerCase();

      if (lower == 'true' || lower == 't' || lower == '1') {
        return new BoolV(true);
      } else {
        return new BoolV(false);
      }
    },
    getCoreValue,
    BoolV
  );
}

export async function getAddressV(world: World, event: Event): Promise<AddressV> {
  return mapValue<AddressV>(
    world,
    event,
    str => new AddressV(getAddress(world, str)),
    async (currWorld, val) => {
      const coreVal = await getCoreValue(currWorld, val);

      if (coreVal instanceof StringV) {
        return new AddressV(coreVal.val);
      } else {
        return coreVal;
      }
    },
    AddressV
  );
}

function strToNumberV(str: string): NumberV {
  if (isNaN(Number(str))) {
    throw 'not a number';
  }

  return new NumberV(str);
}

function strToExpNumberV(str: string): NumberV {
  const r = new BigNumber(str);

  return new NumberV(r.multipliedBy(expMantissa).toFixed());
}

export async function getNumberV(world: World, event: Event): Promise<NumberV> {
  return mapValue<NumberV>(world, event, strToNumberV, getCoreValue, NumberV);
}

export async function getExpNumberV(world: World, event: Event): Promise<NumberV> {
  let res = await mapValue<NumberV>(world, event, strToNumberV, getCoreValue, NumberV);

  const r = new BigNumber(res.val);

  return new ExpNumberV(r.multipliedBy(expMantissa).toFixed());
}

export async function getPercentV(world: World, event: Event): Promise<NumberV> {
  let res = await getExpNumberV(world, event);

  return new PercentV(res.val);
}

// Note: MapV does not currently parse its contents
export async function getMapV(world: World, event: Event): Promise<MapV> {
  const res: object = {};

  await Promise.all(
    mustArray(event).map(async e => {
      if (Array.isArray(e) && e.length === 2 && typeof e[0] === 'string') {
        const [key, valueEvent] = e;
        let value;
        if (typeof valueEvent === 'string') {
          value = new StringV(valueEvent);
        } else {
          value = await getCoreValue(world, <Event>valueEvent);
        }

        res[key] = value;
      } else {
        throw new Error(`Expected all string pairs for MapV from ${event.toString()}, got: ${e.toString()}`);
      }
    })
  );

  return new MapV(res);
}

export async function getStringV(world: World, event: Event): Promise<StringV> {
  return mapValue<StringV>(world, event, str => new StringV(str), getCoreValue, StringV);
}

async function getEtherBalance(world: World, address: string): Promise<NumberV> {
  let balance = await world.web3.eth.getBalance(address);

  return new NumberV(balance);
}

export const fetchers = [
  new Fetcher<{}, BoolV>(
    `
      #### True

      * "True" - Returns true
    `,
    'True',
    [],
    async (world, {}) => new BoolV(true)
  ),

  new Fetcher<{}, BoolV>(
    `
      #### False

      * "False" - Returns false
    `,
    'False',
    [],
    async (world, {}) => new BoolV(false)
  ),

  new Fetcher<{}, NumberV>(
    `
      #### Zero

      * "Zero" - Returns 0
    `,
    'Zero',
    [],
    async (world, {}) => strToNumberV('0')
  ),

  new Fetcher<{}, NumberV>(
    `
      #### Max

      * "Max" - Returns 2^256 - 1
    `,
    'Max',
    [],
    async (world, {}) =>
      new NumberV('115792089237316195423570985008687907853269984665640564039457584007913129639935')
  ),

  new Fetcher<{}, NumberV>(
    `
      #### Some

      * "Some" - Returns 100e18
    `,
    'Some',
    [],
    async (world, {}) => strToNumberV('100e18')
  ),

  new Fetcher<{}, NumberV>(
    `
      #### Little

      * "Little" - Returns 100e10
    `,
    'Little',
    [],
    async (world, {}) => strToNumberV('100e10')
  ),

  new Fetcher<{ amt: EventV }, NumberV>(
    `
      #### Exactly

      * "Exactly <Amount>" - Returns a strict numerical value
        * E.g. "Exactly 5.0"
    `,
    'Exactly',
    [new Arg('amt', getEventV)],
    async (world, { amt }) => getNumberV(world, amt.val)
    ),

  new Fetcher<{ hexVal: EventV }, StringV>(
    `
      #### Hex

      * "Hex <HexVal>" - Returns a byte string with given hex value
        * E.g. "Hex \"0xffff\""
    `,
    'Hex',
    [new Arg('hexVal', getEventV)],
    async (world, { hexVal }) => getStringV(world, hexVal.val)
  ),

  new Fetcher<{ str: EventV }, StringV>(
    `
      #### String

      * "String <Str>" - Returns a string literal
        * E.g. "String MyString"
    `,
    'String',
    [new Arg('str', getEventV)],
    async (world, { str }) => getStringV(world, str.val)
  ),

  new Fetcher<{ amt: EventV }, NumberV>(
    `
      #### Exp

      * "Exp <Amount>" - Returns the mantissa for a given exp
        * E.g. "Exp 5.5"
    `,
    'Exp',
    [new Arg('amt', getEventV)],
    async (world, { amt }) => getExpNumberV(world, amt.val)
  ),

  new Fetcher<{ amt: EventV }, NumberV>(
    `
      #### Neg

      * "Neg <Amount>" - Returns the amount subtracted from zero
        * E.g. "Neg amount"
    `,
    'Neg',
    [new Arg('amt', getEventV)],
    async (world, { amt }) => new NumberV(0).sub(await getNumberV(world, amt.val))
  ),

  new Fetcher<{ amt: StringV }, PreciseV>(
    `
      #### Precisely

      * "Precisely <Amount>" - Matches a number to given number of significant figures
        * E.g. "Precisely 5.1000" - Matches to 5 sig figs
    `,
    'Precisely',
    [new Arg('amt', getStringV)],
    async (world, { amt }) => new PreciseV(toEncodableNum(amt.val), getSigFigs(amt.val))
  ),

  new Fetcher<{}, AnythingV>(
    `
      #### Anything

      * "Anything" - Matches any value for assertions
    `,
    'Anything',
    [],
    async (world, {}) => new AnythingV()
  ),

  new Fetcher<{}, NothingV>(
    `
      #### Nothing

      * "Nothing" - Matches no values and is nothing.
    `,
    'Nothing',
    [],
    async (world, {}) => new NothingV()
  ),

  new Fetcher<{ addr: AddressV }, AddressV>(
    `
      #### Address

      * "Address arg:<Address>" - Returns an address
    `,
    'Address',
    [new Arg('addr', getAddressV)],
    async (world, { addr }) => addr
  ),

  new Fetcher<
    { addr: AddressV; slot: NumberV; start: NumberV; valType: StringV },
    BoolV | AddressV | ExpNumberV | undefined
  >(
    `
    #### StorageAt

    * "StorageAt addr:<Address> slot:<Number> start:<Number>, valType:<VToCastTo>" - Returns bytes at storage slot
    `,
    'StorageAt',
    [
      new Arg('addr', getAddressV),
      new Arg('slot', getNumberV),
      new Arg('start', getNumberV),
      new Arg('valType', getStringV)
    ],
    async (world, { addr, slot, start, valType }) => {
      let stored = await world.web3.eth.getStorageAt(addr.val, slot.val);
      const startVal = start.val;
      let reverse = s =>
        s
          .split('')
          .reverse()
          .join('');
      let val;
      stored = stored
        .slice(2) //drop leading 0x and reverse since items are packed from the back of the slot
        .split('')
        .reverse()
        .join('');

      //dont forget to re-reverse
      switch (valType.val) {
        case 'bool':
          val = '0x' + reverse(stored.slice(startVal, (startVal as number) + 2));
          return new BoolV(val != '0x' && val != '0x0');
        case 'address':
          val = '0x' + reverse(stored.slice(startVal, (startVal as number) + 40));
          return new AddressV(val);
        case 'number':
          let parsed = world.web3.utils.toBN('0x' + reverse(stored));

          // if the numbers are big, they are big...
          if (parsed.gt(world.web3.utils.toBN(1000))) {
            return new ExpNumberV(parsed, 1e18);
          } else {
            return new ExpNumberV(parsed, 1);
          }
      }
    }
  ),

  new Fetcher<
    { addr: AddressV; slot: NumberV; key: AddressV; nestedKey: AddressV; valType: StringV },
    ListV | undefined
  >(
    `
    #### StorageAtNestedMapping

    * "StorageAtNestedMapping addr:<Address> slot:<Number>, key:<address>, nestedKey:<address>, valType:<VToCastTo>" - Returns bytes at storage slot
    `,
    'StorageAtNestedMapping',
    [
      new Arg('addr', getAddressV),
      new Arg('slot', getNumberV),
      new Arg('key', getAddressV),
      new Arg('nestedKey', getAddressV),
      new Arg('valType', getStringV)
    ],
    async (world, { addr, slot, key, nestedKey, valType }) => {
      let paddedSlot = world.web3.utils.padLeft(slot.val, 64);
      let paddedKey = world.web3.utils.padLeft(key.val, 64);
      let newKey = world.web3.utils.sha3(paddedKey + paddedSlot, { encoding: 'hex' });

      let val = await world.web3.eth.getStorageAt(addr.val, newKey);

      switch (valType.val) {
        case 'marketStruct':
          let isListed = val == '0x01';
          let collateralFactorKey =
            '0x' +
            world.web3.utils
              .toBN(newKey)
              .add(world.web3.utils.toBN(1))
              .toString(16);

          let collateralFactor = await world.web3.eth.getStorageAt(addr.val, collateralFactorKey);
          collateralFactor = world.web3.utils.toBN(collateralFactor);

          let userMarketBaseKey = world.web3.utils
            .toBN(newKey)
            .add(world.web3.utils.toBN(2))
            .toString(16);
          userMarketBaseKey = world.web3.utils.padLeft(userMarketBaseKey, 64);

          let paddedSlot = world.web3.utils.padLeft(userMarketBaseKey, 64);
          let paddedKey = world.web3.utils.padLeft(nestedKey.val, 64);
          let newKeyToo = world.web3.utils.sha3(paddedKey + paddedSlot, { encoding: 'hex' });

          let userInMarket = await world.web3.eth.getStorageAt(addr.val, newKeyToo);

          return new ListV([
            new BoolV(isListed),
            new ExpNumberV(collateralFactor, 1e18),
            new BoolV(userInMarket == '0x01')
          ]);
      }
    }
  ),

  new Fetcher<
    { addr: AddressV; slot: NumberV; key: AddressV; valType: StringV },
    AddressV | BoolV | ExpNumberV | ListV | undefined
  >(
    `
    #### StorageAtMapping

    * "StorageAtMapping addr:<Address> slot:<Number>, key:<address>, valType:<VToCastTo>" - Returns bytes at storage slot
    `,
    'StorageAtMapping',
    [
      new Arg('addr', getAddressV),
      new Arg('slot', getNumberV),
      new Arg('key', getAddressV),
      new Arg('valType', getStringV)
    ],
    async (world, { addr, slot, key, valType }) => {
      let paddedSlot = world.web3.utils.padLeft(slot.val, 64);
      let paddedKey = world.web3.utils.padLeft(key.val, 64);
      let newKey = world.web3.utils.sha3(paddedKey + paddedSlot, { encoding: 'hex' });

      let val = await world.web3.eth.getStorageAt(addr.val, newKey);

      switch (valType.val) {
        case 'list(address)':
          let num = world.web3.utils.toBN(val);

          let p = new Array(num, 'n').map(async (_v, index) => {
            let itemKey;
            itemKey = world.web3.utils.sha3(newKey, { encoding: 'hex' });
            itemKey =
              '0x' +
              world.web3.utils
                .toBN(itemKey)
                .add(world.web3.utils.toBN(index))
                .toString(16);

            let x = await world.web3.eth.getStorageAt(addr.val, itemKey);

            return new AddressV(x);
          });

          let all = await Promise.all(p);
          return new ListV(all);

        case 'bool':
          return new BoolV(val != '0x' && val != '0x0');
        case 'address':
          return new AddressV(val);
        case 'number':
          let parsed = world.web3.utils.toBN(val);

          // if the numbers are big, they are big...
          if (parsed.gt(world.web3.utils.toBN(1000))) {
            return new ExpNumberV(parsed, 1e18);
          } else {
            return new ExpNumberV(parsed, 1);
          }
      }
    }
  ),

  new Fetcher<{}, AddressV>(
    `
      #### LastContract

      * "LastContract" - The address of last constructed contract
    `,
    'LastContract',
    [],
    async (world, {}) => new AddressV(world.get('lastContract'))
  ),
  new Fetcher<{}, NumberV>(
    `
      #### LastGas

      * "LastGas" - The gas consumed by the last transaction
    `,
    'LastGas',
    [],
    async (world, {}) => {
      let invokation = world.get('lastInvokation');
      if (!invokation) {
        throw new Error(`Expected last invokation for "lastGas" but none found.`);
      }

      if (!invokation.receipt) {
        throw new Error(`Expected last invokation to have receipt for "lastGas" but none found.`);
      }

      return new NumberV(invokation.receipt.gasUsed);
    }
  ),
  new Fetcher<{ els: Value[] }, AnythingV>(
    `
      #### List

      * "List ..." - Returns a list of given elements
    `,
    'List',
    [new Arg('els', getCoreValue, { variadic: true, mapped: true })],
    async (world, { els }) => new ListV(els)
  ),
  new Fetcher<{ val: Value; def: EventV }, Value>(
    `
      #### Default

      * "Default val:<Value> def:<Value>" - Returns value if truthy, otherwise default. Note: this **does** short circuit.
    `,
    'Default',
    [new Arg('val', getCoreValue), new Arg('def', getEventV)],
    async (world, { val, def }) => {
      if (val.truthy()) {
        return val;
      } else {
        return await getCoreValue(world, def.val);
      }
    }
  ),
  new Fetcher<{ minutes: NumberV }, NumberV>(
    `
      #### Minutes

      * "Minutes minutes:<NumberV>" - Returns number of minutes in seconds
    `,
    'Minutes',
    [new Arg('minutes', getNumberV)],
    async (world, { minutes }) => {
      const minutesBn = new BigNumber(minutes.val);
      return new NumberV(minutesBn.times(60).toFixed(0));
    }
  ),
  new Fetcher<{ hours: NumberV }, NumberV>(
    `
      #### Hours

      * "Hours hours:<NumberV>" - Returns number of hours in seconds
    `,
    'Hours',
    [new Arg('hours', getNumberV)],
    async (world, { hours }) => {
      const hoursBn = new BigNumber(hours.val);
      return new NumberV(hoursBn.times(3600).toFixed(0));
    }
  ),
  new Fetcher<{ days: NumberV }, NumberV>(
    `
      #### Days

      * "Days days:<NumberV>" - Returns number of days in seconds
    `,
    'Days',
    [new Arg('days', getNumberV)],
    async (world, { days }) => {
      const daysBn = new BigNumber(days.val);
      return new NumberV(daysBn.times(86400).toFixed(0));
    }
  ),
  new Fetcher<{ weeks: NumberV }, NumberV>(
    `
      #### Weeks

      * "Weeks weeks:<NumberV>" - Returns number of weeks in seconds
    `,
    'Weeks',
    [new Arg('weeks', getNumberV)],
    async (world, { weeks }) => {
      const weeksBn = new BigNumber(weeks.val);
      return new NumberV(weeksBn.times(604800).toFixed(0));
    }
  ),
  new Fetcher<{ years: NumberV }, NumberV>(
    `
      #### Years

      * "Years years:<NumberV>" - Returns number of years in seconds
    `,
    'Years',
    [new Arg('years', getNumberV)],
    async (world, { years }) => {
      const yearsBn = new BigNumber(years.val);
      return new NumberV(yearsBn.times(31536000).toFixed(0));
    }
  ),
  new Fetcher<{ seconds: NumberV }, NumberV>(
    `
      #### FromNow

      * "FromNow seconds:<NumberV>" - Returns future timestamp of given seconds from now
    `,
    'FromNow',
    [new Arg('seconds', getNumberV)],
    async (world, { seconds }) => {
      const secondsBn = new BigNumber(seconds.val);
      const now = Math.floor(Date.now() / 1000);
      return new NumberV(secondsBn.plus(now).toFixed(0));
    }
  ),
  new Fetcher<{}, StringV>(
    `
      #### Network

      * "Network" - Returns the current Network
    `,
    'Network',
    [],
    async world => new StringV(world.network)
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### User

      * "User ...userArgs" - Returns user value
    `,
    'User',
    [new Arg('res', getUserValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: userFetchers() }
  ),
  new Fetcher<{ address: AddressV }, Value>(
    `
      #### EtherBalance

      * "EtherBalance <Address>" - Returns given address' ether balance.
    `,
    'EtherBalance',
    [new Arg('address', getAddressV)],
    (world, { address }) => getEtherBalance(world, address.val)
  ),
  new Fetcher<{ given: Value; expected: Value }, BoolV>(
    `
      #### Equal

      * "Equal given:<Value> expected:<Value>" - Returns true if given values are equal
        * E.g. "Equal (Exactly 0) Zero"
        * E.g. "Equal (CToken cZRX TotalSupply) (Exactly 55)"
        * E.g. "Equal (CToken cZRX Comptroller) (Comptroller Address)"
    `,
    'Equal',
    [new Arg('given', getCoreValue), new Arg('expected', getCoreValue)],
    async (world, { given, expected }) => new BoolV(expected.compareTo(world, given))
  ),
  new Fetcher<
      {
        argTypes: StringV[];
        args: StringV[];
      },
      StringV
    >(
      `
        #### EncodeParameters

        * "EncodeParameters (...argTypes:<String>) (...args:<Anything>)
          * E.g. "EncodeParameters (\"address\" \"address\") (\"0xabc\" \"0x123\")
      `,
      'EncodeParameters',
      [
        new Arg('argTypes', getStringV, { mapped: true }),
        new Arg('args', getStringV, { mapped: true })
      ],
      async (world, { argTypes, args }) => {
        const realArgs = args.map((a, i) => {
          if (argTypes[i].val == 'address')
            return getAddress(world, a.val);
          return a.val;
        });
        return new StringV(world.web3.eth.abi.encodeParameters(argTypes.map(t => t.val), realArgs));
      }
    ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### Unitroller

      * "Unitroller ...unitrollerArgs" - Returns unitroller value
    `,
    'Unitroller',
    [new Arg('res', getUnitrollerValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: unitrollerFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### Comptroller

      * "Comptroller ...comptrollerArgs" - Returns comptroller value
    `,
    'Comptroller',
    [new Arg('res', getComptrollerValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: comptrollerFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### ComptrollerImpl

      * "ComptrollerImpl ...comptrollerImplArgs" - Returns comptroller implementation value
    `,
    'ComptrollerImpl',
    [new Arg('res', getComptrollerImplValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: comptrollerImplFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### CToken

      * "CToken ...cTokenArgs" - Returns cToken value
    `,
    'CToken',
    [new Arg('res', getCTokenValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: cTokenFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### CTokenDelegate

      * "CTokenDelegate ...cTokenDelegateArgs" - Returns cToken delegate value
    `,
    'CTokenDelegate',
    [new Arg('res', getCTokenDelegateValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: cTokenDelegateFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### Erc20

      * "Erc20 ...erc20Args" - Returns Erc20 value
    `,
    'Erc20',
    [new Arg('res', getErc20Value, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: erc20Fetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### InterestRateModel

      * "InterestRateModel ...interestRateModelArgs" - Returns InterestRateModel value
    `,
    'InterestRateModel',
    [new Arg('res', getInterestRateModelValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: interestRateModelFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### PriceOracle

      * "PriceOracle ...priceOracleArgs" - Returns PriceOracle value
    `,
    'PriceOracle',
    [new Arg('res', getPriceOracleValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: priceOracleFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### PriceOracleProxy

      * "PriceOracleProxy ...priceOracleProxyArgs" - Returns PriceOracleProxy value
    `,
    'PriceOracleProxy',
    [new Arg('res', getPriceOracleProxyValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: priceOracleProxyFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### Timelock

      * "Timelock ...timeLockArgs" - Returns Timelock value
    `,
    'Timelock',
    [new Arg('res', getTimelockValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: timelockFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### Maximillion

      * "Maximillion ...maximillionArgs" - Returns Maximillion value
    `,
    'Maximillion',
    [new Arg('res', getMaximillionValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: maximillionFetchers() }
  ),
  new Fetcher<{ res: Value }, Value>(
    `
      #### MCD

      * "MCD ...mcdArgs" - Returns MCD value
    `,
    'MCD',
    [new Arg('res', getMCDValue, { variadic: true })],
    async (world, { res }) => res,
    { subExpressions: mcdFetchers() }
  )
];

export async function getCoreValue(world: World, event: Event): Promise<Value> {
  return await getFetcherValue<any, any>('Core', fetchers, world, event);
}
