import type { HamletProviderRequest, HamletProviderResponse } from './hamletTypes'

export interface AIProvider {
  readonly id: string
  readonly name: string
  sendMessage(request: HamletProviderRequest): Promise<HamletProviderResponse>
}
