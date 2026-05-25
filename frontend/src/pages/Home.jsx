import { Link } from "react-router-dom";
import heroImg from "../assets/hero.png";

const FEATURES = [
    {
        icon: "📎",
        title: "drop your notes",
        body: "pdf, docx, images, plain text — upload it and studybud reads it for you.",
    },
    {
        icon: "💬",
        title: "ask questions",
        body: "chat with your material like it's a tutor who actually did the reading.",
    },
    {
        icon: "🎯",
        title: "get quizzed",
        body: "auto-generated quizzes that find your weak topics and tell you what to review.",
    },
];

export default function Home() {
    return (
        <div className="min-h-screen flex flex-col bg-[#faf9f6] text-[#1a1a1a]">
            <Navbar />
            <Hero />
            <Features />
            <Footer />
        </div>
    );
}

function Navbar() {
    return (
        <header className="sticky top-0 z-40 border-b border-gray-200 bg-[#faf9f6]/80 backdrop-blur">
            <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link to="/" className="text-lg font-bold tracking-tight">
                    📚 studybud
                </Link>
                <div className="flex items-center gap-2 sm:gap-4">
                    <Link
                        to="/login"
                        className="px-3 py-2 text-sm font-medium text-gray-700 hover:text-black transition"
                    >
                        log in
                    </Link>
                    <Link
                        to="/signup"
                        className="px-4 py-2 text-sm font-medium bg-black text-white rounded-lg hover:bg-gray-800 transition"
                    >
                        sign up
                    </Link>
                </div>
            </nav>
        </header>
    );
}

function Hero() {
    return (
        <section className="flex-1 max-w-6xl mx-auto w-full px-6 py-16 md:py-24 grid md:grid-cols-2 gap-12 items-center">
            <div>
                <div className="inline-flex items-center gap-2 text-xs font-medium text-violet-700 bg-violet-100 border border-violet-200 rounded-full px-3 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-600" />
                    your study buddy
                </div>

                <h1 className="mt-5 text-4xl md:text-5xl font-bold leading-tight">
                    drop your notes. ask questions. let the AI quiz you.
                </h1>
                <p className="mt-4 text-gray-500 text-base md:text-lg max-w-md">
                    that's the whole thing. turn any document into a tutor that answers
                    questions and quizzes you until it sticks.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                    <Link
                        to="/signup"
                        className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition"
                    >
                        get started free
                    </Link>
                    <Link
                        to="/login"
                        className="px-6 py-3 border border-gray-300 rounded-lg font-medium hover:border-black transition"
                    >
                        log in
                    </Link>
                </div>

                <p className="mt-4 text-xs text-gray-500">
                    no credit card. sign up takes 30 seconds.
                </p>
            </div>

            <div className="flex justify-center md:justify-end">
                <div className="relative">
                    <div className="absolute -inset-6 bg-violet-200/40 blur-3xl rounded-full" />
                    <img
                        src={heroImg}
                        alt="studybud"
                        className="relative w-64 md:w-80 select-none"
                        draggable={false}
                    />
                </div>
            </div>
        </section>
    );
}

function Features() {
    return (
        <section className="border-t border-gray-200 bg-white">
            <div className="max-w-6xl mx-auto px-6 py-16 grid sm:grid-cols-3 gap-6">
                {FEATURES.map((f) => (
                    <div
                        key={f.title}
                        className="rounded-2xl border border-gray-200 p-6 hover:border-black transition"
                    >
                        <div className="text-3xl">{f.icon}</div>
                        <div className="mt-3 font-semibold">{f.title}</div>
                        <p className="mt-1 text-sm text-gray-500 leading-relaxed">{f.body}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function Footer() {
    return (
        <footer className="border-t border-gray-200">
            <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
                <div className="font-bold tracking-tight text-[#1a1a1a]">📚 studybud</div>
                <div className="flex items-center gap-4">
                    <Link to="/login" className="hover:text-black transition">
                        log in
                    </Link>
                    <Link to="/signup" className="hover:text-black transition">
                        sign up
                    </Link>
                </div>
            </div>
        </footer>
    );
}
