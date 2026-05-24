from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.routes import auth as auth_routes
from app.routes import materials as materials_routes
from app.routes import chat as chat_routes
from app.routes import quiz as quiz_routes
from app.deps import get_current_user
from app.models import User
from app.schemas import UserOut

app = FastAPI(title="Study Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(materials_routes.router)
app.include_router(chat_routes.router)
app.include_router(quiz_routes.router)

@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
