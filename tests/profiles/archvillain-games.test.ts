import { describe, it, expect } from 'vitest'
import {
  stripPresupported,
  poseNumber,
  poseModelName,
  isModelFile,
  isImageFile,
  provenanceTag,
} from '../../src/profiles/archvillain-games.js'

describe('stripPresupported', () => {
  it('removes a trailing " - Presupported"', () => {
    expect(stripPresupported('Vaultsworn Zealot - Presupported')).toBe('Vaultsworn Zealot')
    expect(stripPresupported('Khepresh - The Vault Father - Presupported')).toBe('Khepresh - The Vault Father')
  })

  it('is case-insensitive and tolerates spacing', () => {
    expect(stripPresupported('Scarab Spawn - presupported')).toBe('Scarab Spawn')
    expect(stripPresupported('Sebau Worm - PRESUPPORTED')).toBe('Sebau Worm')
  })

  it('leaves a name with no suffix unchanged', () => {
    expect(stripPresupported('Some Model')).toBe('Some Model')
  })
})

describe('poseNumber', () => {
  it('reads the pose number from an STL filename', () => {
    expect(poseNumber('STL_Zealot_01_supported.stl')).toBe('01')
    expect(poseNumber('STL_Zealot_01_base_scenic_supported.stl')).toBe('01')
    expect(poseNumber('STL_Spawn_04_base_standard_supported.stl')).toBe('04')
  })

  it('reads the pose number from a render image filename', () => {
    expect(poseNumber('EoSVS.IndPres.VaultswornZealot01.jpg')).toBe('01')
    expect(poseNumber('EoSVS.IndPres.ScarabSpawn03.jpg')).toBe('03')
  })

  it('returns null for kitbash part files with no pose number', () => {
    expect(poseNumber('STL_Khepresh_arm_l_supported.stl')).toBeNull()
    expect(poseNumber('STL_Khepresh_body_supported.stl')).toBeNull()
    expect(poseNumber('HOLLOWED_STL_Khepresh_base_standard_supported.stl')).toBeNull()
  })

  it('returns null for non-pose images', () => {
    expect(poseNumber('EoSVS.IndPres.Khepresh.jpg')).toBeNull()
    expect(poseNumber('EoSVS.IndPres.Khepresh.CloseUp.jpg')).toBeNull()
  })

  it('ignores stray single digits (version/part suffixes)', () => {
    expect(poseNumber('STL_Khepresh_arm_v2_supported.stl')).toBeNull()
    expect(poseNumber('EoSVS.IndPres.Khepresh.CloseUp2.jpg')).toBeNull()
    expect(poseNumber('STL_Khepresh_head_v2.stl')).toBeNull()
  })
})

describe('poseModelName', () => {
  it('appends the pose number with the leading zero stripped', () => {
    expect(poseModelName('Vaultsworn Zealot', '01')).toBe('Vaultsworn Zealot 1')
    expect(poseModelName('Scarab Spawn', '04')).toBe('Scarab Spawn 4')
    expect(poseModelName('Sebau Worm', '10')).toBe('Sebau Worm 10')
  })
})

describe('isModelFile', () => {
  it('accepts STL and 3MF, rejects Lychee and images', () => {
    expect(isModelFile('STL_Zealot_01_supported.stl')).toBe(true)
    expect(isModelFile('Model.3mf')).toBe(true)
    expect(isModelFile('LYS_Zealot_01_supported.lys')).toBe(false)
    expect(isModelFile('EoSVS.IndPres.VaultswornZealot01.jpg')).toBe(false)
  })
})

describe('isImageFile', () => {
  it('accepts common render image extensions', () => {
    expect(isImageFile('EoSVS.IndPres.VaultswornZealot01.jpg')).toBe(true)
    expect(isImageFile('render.png')).toBe(true)
    expect(isImageFile('STL_Zealot_01_supported.stl')).toBe(false)
    expect(isImageFile('LYS_Zealot_01_supported.lys')).toBe(false)
  })
})

describe('provenanceTag', () => {
  it('reads AVS / AVB markers from render filenames', () => {
    expect(provenanceTag(['EoSVS.IndPres.AVS.Khalef.jpg'])).toBe('society')
    expect(provenanceTag(['EoSVS.IndPres.AVB.Hoardlurk.jpg'])).toBe('bestiary')
  })

  it('returns null for the month\'s core themed models', () => {
    expect(provenanceTag(['EoSVS.IndPres.VaultswornZealot01.jpg'])).toBeNull()
    expect(provenanceTag(['EoSVS.IndPres.Khepresh.jpg', 'EoSVS.IndPres.Khepresh.CloseUp.jpg'])).toBeNull()
    expect(provenanceTag([])).toBeNull()
  })
})
