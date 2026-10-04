// Preact + htm in one file, served from node_modules by server.js. No build step needed.
import { Component, h } from '/vendor/preact.js'

export { html, render, h, Component, createContext, useState, useReducer, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext } from '/vendor/preact.js'

// Joins truthy class names: cx('btn', active && 'is-active').
export const cx = (...names) => names.filter(Boolean).join(' ')

export function shallowEqual (a, b) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => Object.is(a[key], b[key]))
}

// Skips re-rendering a component while its props stay equal.
export function memo (component, equal = shallowEqual) {
  class Memo extends Component {
    shouldComponentUpdate (next) { return !equal(this.props, next) }
    render (props) { return h(component, props) }
  }
  Memo.displayName = `Memo(${component.name})`
  return Memo
}
