#!/usr/bin/env node
import { Effect, Layer } from 'effect'
import { NodeRuntime } from '@effect/platform-node'
import { mcpConfig } from './config.js'
import { serverLayer } from './server.js'

NodeRuntime.runMain(Layer.launch(Layer.unwrap(Effect.map(mcpConfig, serverLayer))))
