import { apiGet, apiPost } from './client'
import type { EtiquetteItem } from '../../types'

interface SettingsData {
  regionUnits: string[]
  etiquetteItems: EtiquetteItem[]
}

export async function getRegionUnits(): Promise<string[]> {
  const data = await apiGet<SettingsData>('/api/settings')
  return data.regionUnits
}

export async function addRegionUnit(unit: string): Promise<void> {
  await apiPost('/api/settings/region-units', { unit })
}

export async function getEtiquetteItems(): Promise<EtiquetteItem[]> {
  const data = await apiGet<SettingsData>('/api/settings')
  return data.etiquetteItems
}

export async function initializeDefaultData(): Promise<void> {
  await apiPost('/api/settings/init')
}
