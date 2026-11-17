"use client"
import { apiBrowser } from "@/lib/api/browser"
import { makeCatalogClient } from "./client"

/** The browser's projects, milestones and templates client (one place, so a component never builds its own). */
export const createCatalog = () => makeCatalogClient(apiBrowser)
