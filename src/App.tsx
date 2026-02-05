function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex flex-col items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-4">
          Loom Clone
        </h1>
        <p className="text-xl text-purple-200 mb-8">
          Record and share video messages
        </p>
        <div className="flex gap-4 justify-center">
          <button className="bg-purple-500 hover:bg-purple-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200">
            Start Recording
          </button>
          <button className="bg-transparent border-2 border-purple-400 hover:bg-purple-800 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200">
            View Library
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
