import fs from 'fs'
import path from 'path'
import os from 'os'
import { describe, expect, it, beforeEach } from 'vitest'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-study-plan-'))
process.env.JARVIS_DATA_DIR = path.join(TMP, 'data')
process.env.VITEST = '1'

import { addOrMergeExam, addOrMergeTask, ensureCourse } from '@/lib/hub/academic'
import { buildStudyPlan, formatStudyPlan, upcoming } from '@/lib/hub/studyPlan'
import { hubDir } from '@/lib/hub/store'

const DAY = 86400_000
const now = Date.now()
const origin = (where: string) => ({ source: 'manual' as const, where, at: now })

beforeEach(() => {
  fs.rmSync(hubDir(), { recursive: true, force: true })
})

describe('plano de estudos', () => {
  it('aloca blocos para provas próximas e entregas próximas', () => {
    const course = ensureCourse('Algoritmos', 'user', { professors: ['Prof. X'] })
    addOrMergeExam({ courseId: course.id, title: 'Prova de Algoritmos', date: now + 3 * DAY, origin: origin('turma'), createdBy: 'user' })
    addOrMergeTask({ courseId: course.id, title: 'Trabalho de estruturas', due: now + 5 * DAY, type: 'trabalho', origin: origin('turma'), createdBy: 'user' })

    const blocks = buildStudyPlan(now)
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    expect(blocks.some(b => b.kind === 'exam' && b.reason.includes('Algoritmos'))).toBe(true)
    expect(blocks.some(b => b.kind === 'task' && b.reason.includes('estruturas'))).toBe(true)
    for (const b of blocks) expect(b.durationMin).toBeGreaterThanOrEqual(45)
  })

  it('não cria plano quando não há nada no horizonte', () => {
    const text = formatStudyPlan(now)
    expect(text).toContain('tudo em dia')
    expect(buildStudyPlan(now).length).toBe(0)
  })

  it('limita a quantidade de blocos por dia', () => {
    const course = ensureCourse('BD', 'user')
    for (let i = 0; i < 6; i++) {
      addOrMergeTask({ courseId: course.id, title: `Lista ${i + 1}`, due: now + (i + 1) * DAY, type: 'atividade', origin: origin('turma'), createdBy: 'user' })
    }
    const counts = new Map<string, number>()
    for (const b of buildStudyPlan(now, 3)) counts.set(b.day, (counts.get(b.day) || 0) + 1)
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(3)
  })

  it('upcoming retorna só o horizonte relevante', () => {
    ensureCourse('BD', 'user')
    addOrMergeExam({ courseId: undefined, title: 'Prova distante', date: now + 30 * DAY, origin: origin('x'), createdBy: 'user' })
    addOrMergeExam({ courseId: undefined, title: 'Prova próxima', date: now + 5 * DAY, origin: origin('x'), createdBy: 'user' })
    const { exams } = upcoming(now)
    expect(exams.some(e => e.title === 'Prova próxima')).toBe(true)
    expect(exams.some(e => e.title === 'Prova distante')).toBe(false)
  })
})
