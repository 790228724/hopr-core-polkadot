import { AccountId, Hash, Moment } from '../srml_types'
import { ApiPromise } from '@polkadot/api'
import { u8aConcat } from '@polkadot/util'
import { blake2b, waitReady } from '@polkadot/wasm-crypto'
import chalk from 'chalk'

// const ID_HASH_KEY: Uint8Array = Uint8Array.from(new TextEncoder().encode('ChannelId'))

const BYTESIZE: number = 32 // bytes

/**
 * Performs an on-chain hash to the given argument.
 *
 * @param arg argument to hash
 */
export async function hash(arg: Uint8Array): Promise<Uint8Array> {
  await waitReady()
  return blake2b(arg, new Uint8Array(), BYTESIZE)
}

/**
 * Creates an AccountId from a given public key.
 *
 * @param pubkey public key
 * @param api Polkadot API
 */
export async function pubKeyToAccountId(pubkey: Uint8Array, api: ApiPromise): Promise<AccountId> {
  return api.createType('AccountId', pubkey)
}

/**
 * Decides whether `self` takes the role of party A.
 * @param self AccountId of ourself
 * @param counterparty AccountId of the counterparty
 */
export function isPartyA(self: AccountId, counterparty: AccountId): boolean {
  return self < counterparty
}

/**
 * Computes the Id of channel between `self` and `counterparty`.
 * @param api the Polkadot API
 * @param self AccountId of ourself
 * @param counterparty AccountId of the counterparty
 */
export async function getId(self: AccountId, counterparty: AccountId, api: ApiPromise): Promise<Hash> {
  if (isPartyA(self, counterparty)) {
    return api.createType('Hash', await hash(u8aConcat(self, counterparty)))
  } else {
    return api.createType('Hash', await hash(u8aConcat(counterparty, self)))
  }
}

/**
 * Checks whether the content of both arrays is the same.
 * @param a first array
 * @param b second array
 */
export function compareArray(a: Uint8Array, b: Uint8Array) {
  return a.length == b.length && a.every((value, index) => value == b[index])
}

/**
 * Waits for the next block.
 * @param api the Polkadot API
 */
export function waitForNextBlock(api: ApiPromise): Promise<void> {
  return waitUntil(api, 'block')
}

/**
 * Wait until some on-chain event takes place and gives up after `maxBlocks`
 * in case there were no such events.
 * @param api the Polkadot API
 * @param forWhat name of the event that should happen
 * @param until performs a truth test on the requested event
 * @param maxBlocks maximum amount of blocks to wait
 */
export function waitUntil(
  api: ApiPromise,
  forWhat: string,
  until?: (api: ApiPromise, timestamp?: Moment) => boolean,
  maxBlocks?: number
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    const currentBlock = await api.query.timestamp.now<Moment>()
    let i: number = 0
    const unsub = await api.query.timestamp.now<Moment>(async (timestamp: Moment) => {
      if (timestamp.gt(currentBlock)) {
        i++

        console.log(`Waiting for ${chalk.green(forWhat)} ... current timestamp ${chalk.green(timestamp.toString())}`)

        if (until == null || until(api, timestamp) == true || (maxBlocks != null && i >= maxBlocks)) {
          setImmediate(() => {
            console.log(`waiting done for ${chalk.green(forWhat)}`)
            unsub()
            if (until != null && maxBlocks != null && i >= maxBlocks) {
              reject()
            } else {
              resolve()
            }
          })
        }
      }
    })
  })
}

/**
 * Pauses the thread for some time.
 * @param miliseconds how long to wait
 */
export function wait(miliseconds: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, miliseconds))
}
