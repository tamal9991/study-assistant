import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api/client'

export default function Quiz() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [report, setReport] = useState(null)   // set if already submitted
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/quiz/${sessionId}`)
        setSession(data)
        if (data.submitted) {
          // load the full report for review mode
          const { data: r } = await api.get(`/quiz/${sessionId}/report`)
          setReport(r)
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Could not load quiz')
      }
    })()
  }, [sessionId])

  const select = (qIdx, optIdx) => {
    if (report) return   // disabled in review mode
    setAnswers((a) => ({ ...a, [qIdx]: optIdx }))
  }

  const submit = async () => {
    if (!session) return
    if (Object.keys(answers).length < session.total_questions) {
      setError('Answer every question before submitting.')
      return
    }
    const ordered = Array.from({ length: session.total_questions }, (_, i) => answers[i])
    setSubmitting(true); setError('')
    try {
      await api.post(`/quiz/${sessionId}/submit`, { answers: ordered })
      navigate(`/chat/${session.conversation_id}`, { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !session) {
    return <div className="min-h-screen flex items-center justify-center"><div className="text-red-600">{error}</div></div>
  }
  if (!session) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading quiz…</div>
  }

  const answered = Object.keys(answers).length
  const isReview = !!report

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <header className="bg-black text-white px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <div className="font-bold text-lg">📝 {isReview ? 'Quiz review' : 'Quiz'}</div>
          <div className="text-xs text-gray-400">
            {isReview
              ? `${report.correct_count}/${report.total_questions} correct`
              : `${session.total_questions} questions`}
          </div>
        </div>
        {isReview ? (
          <button onClick={() => navigate(`/chat/${session.conversation_id}`)}
                  className="text-sm text-gray-300 hover:text-white">
            ← back to chat
          </button>
        ) : (
          <div className="text-sm text-gray-400">
            {answered} / {session.total_questions} answered
          </div>
        )}
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {session.questions.map((q, qIdx) => {
          const pq = isReview ? report.per_question[qIdx] : null
          return (
            <QuestionCard
              key={qIdx}
              index={qIdx}
              question={q}
              selected={isReview ? pq.selected : answers[qIdx]}
              correctOption={isReview ? pq.correct : null}
              isReview={isReview}
              onSelect={(opt) => select(qIdx, opt)}
            />
          )
        })}

        {!isReview && (
          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-gray-500">{answered} / {session.total_questions} answered</div>
            <button onClick={submit} disabled={submitting || answered < session.total_questions}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-6 py-2.5 font-medium disabled:opacity-50">
              {submitting ? 'submitting…' : 'submit quiz'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function QuestionCard({ index, question, selected, correctOption, isReview, onSelect }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-gray-500">
          Q{index + 1} · {question.topic}
        </div>
        {isReview && (
          <div className={`text-xs font-semibold ${selected === correctOption ? 'text-green-700' : 'text-red-700'}`}>
            {selected === correctOption ? '✓ correct' : '✗ wrong'}
          </div>
        )}
      </div>
      <div className="font-medium mb-4">{question.question}</div>
      <div className="space-y-2">
        {question.options.map((opt, i) => {
          let cls = 'border-gray-300 hover:border-black hover:bg-gray-50'
          if (isReview) {
            if (i === correctOption) cls = 'border-green-500 bg-green-50'
            else if (i === selected) cls = 'border-red-500 bg-red-50'
            else cls = 'border-gray-200 opacity-60'
          } else if (selected === i) {
            cls = 'border-black bg-gray-100'
          }
          return (
            <button key={i} onClick={() => onSelect(i)} disabled={isReview}
                    className={`w-full text-left border rounded-lg px-3 py-2 transition ${cls}`}>
              <span className="font-medium mr-2">{String.fromCharCode(65 + i)}.</span>{opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}
