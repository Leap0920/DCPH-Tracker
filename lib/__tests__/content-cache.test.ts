import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { queryKeys } from "@/lib/queries/keys"
import {
  invalidateContentCache,
  subscribeToContentChanges,
  useInvalidateContentCache,
} from "@/lib/queries/client/content-cache"

/**
 * The admin↔tracker cache contract. An admin edit must drop the tracker's
 * one-hour content cache in its own tab (direct invalidation) and in every
 * other open tab (broadcast), or the edit stays invisible until it goes stale.
 */

type StubChannel = {
  name: string
  closed: boolean
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage: (data: unknown) => void
  close: () => void
}

let channels: StubChannel[] = []

/** A minimal BroadcastChannel: postMessage reaches open channels of the same name. */
function installBroadcastChannelStub() {
  channels = []
  class FakeBroadcastChannel implements StubChannel {
    name: string
    closed = false
    onmessage: ((event: { data: unknown }) => void) | null = null
    constructor(name: string) {
      this.name = name
      channels.push(this)
    }
    postMessage(data: unknown) {
      for (const other of channels) {
        if (other !== this && !other.closed && other.name === this.name) {
          other.onmessage?.({ data })
        }
      }
    }
    close() {
      this.closed = true
    }
  }
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)
}

/** Simulates the admin tab announcing an edit, on whichever channel it picked. */
function postFromAnotherTab(name: string, data: unknown) {
  const sender = new (globalThis as unknown as {
    BroadcastChannel: new (name: string) => StubChannel
  }).BroadcastChannel(name)
  sender.postMessage(data)
  sender.close()
}

function makeClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60 * 60 * 1000 } },
  })
  // The tracker's exact key: the hour-long content query.
  client.setQueryData(queryKeys.content.all(), { entries: [], arcMap: null })
  client.setQueryData(["watch-status", "user-1"], { "ep-001": "watched" })
  return client
}

function contentIsStale(client: QueryClient) {
  return client.getQueryState(queryKeys.content.all())?.isInvalidated ?? false
}

/** Runs the hook through SSR (no DOM needed) and returns the callback it built. */
function captureInvalidateCallback(client: QueryClient) {
  const captured: { callback: (() => void) | null } = { callback: null }
  function Probe() {
    captured.callback = useInvalidateContentCache()
    return null
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Probe)),
  )
  if (!captured.callback) throw new Error("hook did not run")
  return captured.callback
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("invalidateContentCache", () => {
  it("invalidates the tracker's content query", () => {
    const client = makeClient()

    invalidateContentCache(client)

    expect(contentIsStale(client)).toBe(true)
  })

  it("leaves unrelated queries alone", () => {
    const client = makeClient()

    invalidateContentCache(client)

    expect(client.getQueryState(["watch-status", "user-1"])?.isInvalidated).toBe(false)
  })
})

describe("useInvalidateContentCache", () => {
  it("invalidates this tab and reaches a tracker tab listening on the same channel", () => {
    installBroadcastChannelStub()
    const adminClient = makeClient()
    const trackerClient = makeClient()
    const trackerTab = subscribeToContentChanges(trackerClient)

    captureInvalidateCallback(adminClient)()

    expect(contentIsStale(adminClient)).toBe(true)
    expect(contentIsStale(trackerClient)).toBe(true)
    trackerTab()
  })

  it("does not touch the other tab's unrelated queries", () => {
    installBroadcastChannelStub()
    const trackerClient = makeClient()
    const trackerTab = subscribeToContentChanges(trackerClient)

    captureInvalidateCallback(makeClient())()

    expect(trackerClient.getQueryState(["watch-status", "user-1"])?.isInvalidated).toBe(false)
    trackerTab()
  })

  it("closes the channel it opened", () => {
    installBroadcastChannelStub()

    captureInvalidateCallback(makeClient())()

    expect(channels).toHaveLength(1)
    expect(channels[0].closed).toBe(true)
  })
})

describe("subscribeToContentChanges", () => {
  it("drops the content cache when another tab reports a change", () => {
    installBroadcastChannelStub()
    const client = makeClient()
    const unsubscribe = subscribeToContentChanges(client)

    expect(contentIsStale(client)).toBe(false)
    postFromAnotherTab(channels[0].name, "changed")

    expect(contentIsStale(client)).toBe(true)
    unsubscribe()
  })

  it("ignores messages on a differently named channel", () => {
    installBroadcastChannelStub()
    const client = makeClient()
    const unsubscribe = subscribeToContentChanges(client)

    postFromAnotherTab("dcph:something-else", "changed")

    expect(contentIsStale(client)).toBe(false)
    unsubscribe()
  })

  it("stops listening once unsubscribed", () => {
    installBroadcastChannelStub()
    const client = makeClient()
    const unsubscribe = subscribeToContentChanges(client)
    const channelName = channels[0].name

    unsubscribe()
    postFromAnotherTab(channelName, "changed")

    expect(contentIsStale(client)).toBe(false)
  })

  it("no-ops where BroadcastChannel is unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined)
    const client = makeClient()

    const unsubscribe = subscribeToContentChanges(client)

    expect(() => unsubscribe()).not.toThrow()
    expect(contentIsStale(client)).toBe(false)
  })
})
