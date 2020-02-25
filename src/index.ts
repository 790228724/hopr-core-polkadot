import { ApiPromise, WsProvider } from '@polkadot/api'
import Keyring from '@polkadot/keyring'
import { KeyringPair } from '@polkadot/keyring/types'
import { LevelUp } from 'levelup'
import { EventSignalling } from './events'
import { Types, SRMLTypes, Balance, Ticket } from './srml_types'
import { randomBytes } from 'crypto'
import { waitReady } from '@polkadot/wasm-crypto'
import * as Utils from './utils'
import DbKeysClass from './dbKeys'
import ConstantsClass from './constants'
import { DEFAULT_URI, DEMO_ACCOUNTS } from './config'
import secp256k1 from 'secp256k1'

import { Channel } from './channel'

import { HoprCoreConnectorInstance } from '@hoprnet/hopr-core-connector-interface'

const DbKeys = new DbKeysClass()
const Constants = new ConstantsClass()

export { Utils, DbKeys, Constants, Channel, Types, Ticket }

export type HoprPolkadotProps = {
  self: KeyringPair
  api: ApiPromise
  db: LevelUp
}

export type HoprKeyPair = {
  privateKey: Uint8Array
  publicKey: Uint8Array
  keyPair: KeyringPair
}

export default class HoprPolkadotClass implements HoprCoreConnectorInstance {
  private _started: boolean = false
  private _nonce?: number

  eventSubscriptions: EventSignalling

  constructor(public api: ApiPromise, public self: HoprKeyPair, public db: LevelUp) {
    this.eventSubscriptions = new EventSignalling(this.api)
  }

  /**
   * Returns the current account nonce and lazily caches the result.
   */
  get nonce(): Promise<number> {
    if (this._nonce != null) {
      return Promise.resolve(this._nonce++)
    }

    return new Promise<number>(async (resolve, reject) => {
      try {
        this._nonce = (await this.api.query.system.accountNonce(this.self.keyPair.publicKey)).toNumber()
      } catch (err) {
        return reject(err)
      }

      return resolve(this._nonce++)
    })
  }

  /**
   * Starts the connector and initializes the internal state.
   */
  async start(): Promise<void> {
    await waitReady()

    this._started = true
  }

  get started(): boolean {
    return this._started
  }

  /**
   * Initializes the values that we store per user on-chain.
   * @param nonce set nonce manually for batch operations
   */
  async initOnchainValues(nonce?: number): Promise<void> {
    if (!this.started) {
      throw Error('Module is not yet fully initialised.')
    }

    let secret = new Uint8Array(randomBytes(32))

    const dbPromise = this.db.put(this.dbKeys.OnChainSecret(), secret.slice())

    for (let i = 0; i < 500; i++) {
      secret = await this.utils.hash(secret)
    }

    await Promise.all([
      this.api.tx.hopr
        .init(this.api.createType('Hash', this.self.keyPair.publicKey), secret)
        .signAndSend(this.self.keyPair, { nonce: nonce != null ? nonce : await this.nonce }),
      dbPromise
    ])
  }

  /**
   * Stops the connector and interrupts the communication with the blockchain.
   */
  async stop(): Promise<void> {
    const promise = new Promise<void>(resolve => {
      this.api.once('disconnected', () => {
        resolve()
      })
    })

    this.api.disconnect()

    return promise
  }

  /**
   * Returns the current account balance.
   */
  get accountBalance(): Promise<Balance> {
    return this.api.query.balances.freeBalance<Balance>(this.api.createType('AccountId', this.self.keyPair.publicKey))
  }

  readonly utils = Utils

  readonly types = Types

  readonly channel = Channel

  readonly dbKeys = DbKeys

  readonly constants = Constants

  readonly CHAIN_NAME = `HOPR on Polkadot`

  /**
   * Creates an uninitialised instance.
   *
   * @param db database instance
   */
  static async create(
    db: LevelUp,
    seed?: Uint8Array,
    options?: {
      id: number,
      provider: string
    }
  ): Promise<HoprPolkadotClass> {
    const api = ApiPromise.create({
      provider: new WsProvider(options != null && options.provider ? options.provider : DEFAULT_URI),
      types: SRMLTypes
    })

    await waitReady()

    let hoprKeyPair: HoprKeyPair
    if (seed != null) {
      hoprKeyPair = {
        privateKey: seed,
        publicKey: secp256k1.publicKeyCreate(seed),
        keyPair: new Keyring({ type: 'sr25519' }).addFromSeed(seed, undefined, 'sr25519')
      }
    } else if (options != null && options.id != null && isFinite(options.id)) {
      if (options.id > DEMO_ACCOUNTS.length) {
        throw Error(
          `Unable to find demo account for index '${options.id}'. Please make sure that you have specified enough demo accounts.`
        )
      }

      const privateKey = Utils.stringToU8a(DEMO_ACCOUNTS[options.id])
      if (!secp256k1.privateKeyVerify(privateKey)) {
        throw Error(`Unable to import demo account at inde '${options.id}' because seed is not usable.`)
      }

      const publicKey = secp256k1.publicKeyCreate(privateKey)

      if (!secp256k1.publicKeyVerify(publicKey)) {
        throw Error(`Unable to import demo account at inde '${options.id}' because seed is not usable.`)
      }

      hoprKeyPair = {
        privateKey,
        publicKey,
        keyPair: new Keyring({ type: 'sr25519' }).addFromSeed(privateKey, undefined, 'sr25519')
      }
    } else {
      throw Error('Invalid input parameters.')
    }

    return new HoprPolkadotClass(await api, hoprKeyPair, db)
  }
}
