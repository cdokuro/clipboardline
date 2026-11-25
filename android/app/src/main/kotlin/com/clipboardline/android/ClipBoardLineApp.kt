package com.clipboardline.android

import android.app.Application
import com.clipboardline.android.data.ClipRepository

class ClipBoardLineApp : Application() {
    lateinit var repository: ClipRepository
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        repository = ClipRepository(this)
    }

    companion object {
        @Volatile
        lateinit var instance: ClipBoardLineApp
            private set
    }
}
