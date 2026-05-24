import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: "", password: "" });
    const [errors, setErrors] = useState({});
    const [serverError, setServerError] = useState("");
    const [loading, setLoading] = useState(false);

    const validate = () => {
        const e = {};
        if (!form.email) e.email = "Required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "That doesn't look right";
        if (!form.password) e.password = "Required";
        else if (form.password.length < 8) e.password = "At least 8 characters";
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setServerError("");
        if (!validate()) return;
        setLoading(true);
        try {
            await login(form.email, form.password);
            navigate("/chat");
        } catch (err) {
            setServerError(err.response?.data?.detail || "Could not log in");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex">
            <div className="hidden md:flex w-1/2 bg-black text-white p-10 flex-col justify-center">
                <div className="max-w-md">
                    <div className="text-3xl font-bold leading-relaxed">drop your notes. ask questions. let the AI quiz you.</div>
                    <div className="text-sm text-gray-500 mt-4">that's the whole thing.</div>
                </div>
            </div>

            <div className="flex-1 flex items-center justify-center px-6 py-12">
                <form
                    onSubmit={onSubmit}
                    className="w-full max-w-sm space-y-5"
                >
                    <div>
                        <h1 className="text-3xl font-bold">welcome back.</h1>
                        <p className="text-gray-500 mt-1 text-sm">log in to keep going.</p>
                    </div>

                    {serverError && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{serverError}</div>}

                    <Field
                        label="email"
                        error={errors.email}
                    >
                        <input
                            className={inputCls(errors.email)}
                            type="email"
                            autoComplete="email"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                        />
                    </Field>

                    <Field
                        label="password"
                        error={errors.password}
                    >
                        <input
                            className={inputCls(errors.password)}
                            type="password"
                            autoComplete="current-password"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                        />
                    </Field>

                    <button
                        disabled={loading}
                        className="w-full bg-black hover:bg-gray-800 text-white rounded-lg py-2.5 font-medium disabled:opacity-50 transition"
                    >
                        {loading ? "logging in..." : "log in"}
                    </button>

                    <p className="text-sm text-gray-600 text-center">
                        don't have an account?{" "}
                        <Link
                            to="/signup"
                            className="text-black font-medium underline"
                        >
                            sign up
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export function Field({ label, error, children }) {
    return (
        <label className="block">
            <span className="text-xs font-medium text-gray-700 uppercase tracking-wide">{label}</span>
            <div className="mt-1">{children}</div>
            {error && <span className="text-xs text-red-600 mt-1 block">{error}</span>}
        </label>
    );
}

export const inputCls = (hasErr) => `w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-gray-400 ${hasErr ? "border-red-400" : "border-gray-300"}`;
