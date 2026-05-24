import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Field, inputCls } from './Login'

export default function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  const update = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value })
    if (errors[k]) setErrors({ ...errors, [k]: undefined })
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'Required'
    else if (form.name.trim().length < 2) e.name = 'Too short'

    if (!form.username) e.username = 'Required'
    else if (form.username.length < 3) e.username = 'At least 3 characters'
    else if (!/^[a-zA-Z0-9_]+$/.test(form.username)) e.username = 'Letters, numbers, underscores only'

    if (!form.email) e.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email'

    if (!form.password) e.password = 'Required'
    else if (form.password.length < 8) e.password = 'At least 8 characters'
    else if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password))
      e.password = 'Mix letters and numbers'

    if (!form.confirm) e.confirm = 'Required'
    else if (form.confirm !== form.password) e.confirm = "Passwords don't match"

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setServerError('')
    if (!validate()) return
    setLoading(true)
    try {
      await signup(form.name.trim(), form.username, form.email, form.password)
      navigate('/chat')
    } catch (err) {
      setServerError(err.response?.data?.detail || 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden md:flex w-1/2 bg-black text-white p-10 flex-col justify-center">
        <div className="max-w-md">
          <div className="text-3xl font-bold leading-relaxed">
            drop your notes. ask questions. let the AI quiz you.
          </div>
          <div className="text-sm text-gray-500 mt-4">that's the whole thing.</div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-3xl font-bold">create account.</h1>
            <p className="text-gray-500 mt-1 text-sm">takes 30 seconds.</p>
          </div>

          {serverError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              {serverError}
            </div>
          )}

          <Field label="full name" error={errors.name}>
            <input className={inputCls(errors.name)} value={form.name} onChange={update('name')} />
          </Field>

          <Field label="username" error={errors.username}>
            <input className={inputCls(errors.username)} value={form.username} onChange={update('username')} />
          </Field>

          <Field label="email" error={errors.email}>
            <input type="email" className={inputCls(errors.email)} value={form.email} onChange={update('email')} />
          </Field>

          <Field label="password" error={errors.password}>
            <input type="password" className={inputCls(errors.password)} value={form.password} onChange={update('password')} />
          </Field>

          <Field label="confirm password" error={errors.confirm}>
            <input type="password" className={inputCls(errors.confirm)} value={form.confirm} onChange={update('confirm')} />
          </Field>

          <button disabled={loading}
                  className="w-full bg-black hover:bg-gray-800 text-white rounded-lg py-2.5 font-medium disabled:opacity-50 transition">
            {loading ? 'creating...' : 'create account'}
          </button>

          <p className="text-sm text-gray-600 text-center">
            already have one?{' '}
            <Link to="/login" className="text-black font-medium underline">log in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
