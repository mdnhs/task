"use client"

import * as React from "react"

import type { Dept } from "@/lib/types"

// Department filter: set by the shell's topbar, read by any feature that filters by department.
export const DeptContext = React.createContext<Dept>("all")
export const useDept = () => React.useContext(DeptContext)
