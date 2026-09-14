/** The frame the SERVER reserves for a map, shared by both surfaces. It lives
 *  here rather than beside either component because both are `"use client"`:
 *  a public page importing the constant from one of them pulled that whole
 *  component into the page's eager chunk. ./notes.md#the-frame-class-is-not-in-a-client-module */
export const MAP_FRAME_CLASS = "size-full bg-surface";
