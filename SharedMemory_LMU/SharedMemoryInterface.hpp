/******************************************************************************
 *  Copyright (c) 2025 Studio 397 BV and Motorsport Games Inc.
 *  All rights reserved.
 *
 *  This header is part of the Studio 397 Plugin SDK. It may be used solely
 *  for the purpose of developing plugins or extensions for supported Studio 397
 *  products. Redistribution or modification of this header is not permitted.
 *
 *  This file contains proprietary information of Studio 397 B.V. and is
 *  provided on a strictly "as is" basis, without warranty of any kind, either
 *  express or implied. Studio 397 B.V. shall not be liable for any damages
 *  arising out of the use of this file or any plugins created with it.
 ******************************************************************************/
#pragma once
#include "InternalsPlugin.hpp"
#include <optional>

/*
* Usage example:

int main(int argc, char* argv[])
{
    int retVal = 0;
    if (argc < 2) {
        std::cerr << "Usage: child.exe <LMU-pid>\n";
        return 1;
    }
    // Get the LMU Handle
    DWORD parentPid = 0;
    try {
        parentPid = static_cast<DWORD>(std::stoul(argv[1]));
    }
    catch (...) {
        std::cerr << "Invalid parent PID argument.\n";
        return 1;
    }

    auto smLock = SharedMemoryLock::MakeSharedMemoryLock();
    if (!smLock.has_value()) {
        std::cerr << "Cannot initialize SharedMemoryLock.\n";
        return 1;
    }

    // Opens LMU_Data_HoldEvent / LMU_Data_DataEvent. Fails if the core
    // application isn't running, or is running a build that predates this
    // interface.
    auto waiter = SharedMemoryUpdateWaiter::MakeSharedMemoryUpdateWaiter();
    if (!waiter.has_value()) {
        std::cerr << "Cannot connect to shared memory update gate.\n";
        return 1;
    }

    static SharedMemoryObjectOut copiedMem;

    // Try to open a handle to the parent process with SYNCHRONIZE right.
    // SYNCHRONIZE is enough to wait on the process handle for exit.
    HANDLE hParent = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parentPid);
    HANDLE hMapFile = OpenFileMapping(FILE_MAP_ALL_ACCESS, FALSE, L"LMU_Data");

    if (hParent && hMapFile) {
        if (SharedMemoryLayout* pBuf = (SharedMemoryLayout*)MapViewOfFile(hMapFile, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(SharedMemoryLayout))) {
            while (true) {
                // Bail out promptly if the parent process has exited, rather
                // than blocking forever inside WaitForNextFrame.
                if (WaitForSingleObject(hParent, 0) == WAIT_OBJECT_0) {
                    break;
                }

                // Waits on Hold then Data internally, in the only order
                // that's race-free. A short timeout here is just so we can
                // re-check hParent periodically; it's not a rate limit.
                if (waiter->WaitForNextFrame(200)) {
                    smLock->Lock();
                    CopySharedMemoryObj(copiedMem, pBuf->data);
                    smLock->Unlock();
                    // >>>>> ProcessSharedMemory(copiedMem); <<<<
                }
                // false: either a timeout (200ms, no new frame yet) loop back and check hParent again.
            }
            UnmapViewOfFile(pBuf);
        }
        else {
            std::cerr << "Could not map view of file. Error: " << GetLastError() << std::endl;
            retVal = 1;
        }
    }
    else {
        std::cerr << "Something went wrong during initialization. Error: " << GetLastError() << std::endl;
        retVal = 1;
    }
    if (hMapFile)
        CloseHandle(hMapFile);
    if (hParent)
        CloseHandle(hParent);

    return retVal;
}
*/

#define LMU_SHARED_MEMORY_FILE "LMU_Data"
#define LMU_SHARED_MEMORY_HOLD_EVENT "LMU_Data_HoldEvent"
#define LMU_SHARED_MEMORY_DATA_EVENT "LMU_Data_DataEvent"

class SharedMemoryUpdateWaiter {
public:
    static std::optional<SharedMemoryUpdateWaiter> MakeSharedMemoryUpdateWaiter() {
        SharedMemoryUpdateWaiter waiter;
        if (waiter.Init()) {
            return std::move(waiter);
        }
        return std::nullopt;
    }

    bool WaitForNextFrame(DWORD dwMilliseconds = INFINITE) {
        if (WaitForSingleObject(mHoldEvent, dwMilliseconds) != WAIT_OBJECT_0)
            return false;
        if (WaitForSingleObject(mDataEvent, dwMilliseconds) != WAIT_OBJECT_0)
            return false;
        return true;
    }

    ~SharedMemoryUpdateWaiter() {
        if (mHoldEvent) CloseHandle(mHoldEvent);
        if (mDataEvent) CloseHandle(mDataEvent);
    }
    SharedMemoryUpdateWaiter(SharedMemoryUpdateWaiter&& other)
        : mHoldEvent(std::exchange(other.mHoldEvent, nullptr)),
          mDataEvent(std::exchange(other.mDataEvent, nullptr)) {}
    SharedMemoryUpdateWaiter& operator=(SharedMemoryUpdateWaiter&& other) {
        std::swap(mHoldEvent, other.mHoldEvent);
        std::swap(mDataEvent, other.mDataEvent);
        return *this;
    }

private:
    SharedMemoryUpdateWaiter() = default;
    bool Init() {
        mHoldEvent = OpenEventA(SYNCHRONIZE, FALSE, LMU_SHARED_MEMORY_HOLD_EVENT);
        if (!mHoldEvent) return false;

        mDataEvent = OpenEventA(SYNCHRONIZE, FALSE, LMU_SHARED_MEMORY_DATA_EVENT);
        if (!mDataEvent) {
            CloseHandle(mHoldEvent);
            mHoldEvent = nullptr;
            return false;
        }
        return true;
    }

    HANDLE mHoldEvent = nullptr;
    HANDLE mDataEvent = nullptr;
};

enum SharedMemoryEvent : uint32_t {
    SME_ENTER,
    SME_EXIT,
    SME_STARTUP,
    SME_SHUTDOWN,
    SME_LOAD,
    SME_UNLOAD,
    SME_START_SESSION,
    SME_END_SESSION,
    SME_ENTER_REALTIME,
    SME_EXIT_REALTIME,
    SME_UPDATE_SCORING,
    SME_UPDATE_TELEMETRY,
    SME_INIT_APPLICATION,
    SME_UNINIT_APPLICATION,
    SME_SET_ENVIRONMENT,
    SME_FFB,
    SME_MAX
};

class SharedMemoryLock {
public:
    static std::optional<SharedMemoryLock> MakeSharedMemoryLock() {
        SharedMemoryLock memoryLock;
        if (memoryLock.Init()) {
            return std::move(memoryLock);
        }
        return std::nullopt;
    }
    bool Lock(DWORD dwMilliseconds = INFINITE) {
        int MAX_SPINS = 4000;
        for (int spins = 0; spins < MAX_SPINS; ++spins) {
            if (InterlockedCompareExchange(&mDataPtr->busy, 1, 0) == 0)
                return true;
            YieldProcessor(); // CPU pause hint
        }
        InterlockedIncrement(&mDataPtr->waiters);
        bool acquired = false;
        while (true) {
            if (InterlockedCompareExchange(&mDataPtr->busy, 1, 0) == 0) {
                acquired = true;
                break;
            }
            if (WaitForSingleObject(mWaitEventHandle, dwMilliseconds) != WAIT_OBJECT_0)
                break; // timeout or error - give up
        }
        InterlockedDecrement(&mDataPtr->waiters);
        return acquired;
    }
    bool TryLockSpin(uint32_t maxSpins = 1000) {  // Non-blocking lock attempt for time-critical callers
        for (uint32_t spins = 0; spins < maxSpins; ++spins) {
            if (InterlockedCompareExchange(&mDataPtr->busy, 1, 0) == 0)
                return true;
            YieldProcessor();
        }
        return false;
    }
    void Unlock() {
        InterlockedExchange(&mDataPtr->busy, 0);
        if (mDataPtr->waiters > 0) {
            SetEvent(mWaitEventHandle);
        }
    }
    void Reset() { // Call this function only from the core application.
        mDataPtr->waiters = 0;
        mDataPtr->busy = 0;
    }
    ~SharedMemoryLock() {
        if (mWaitEventHandle)
            CloseHandle(mWaitEventHandle);
        if (mMapHandle)
            CloseHandle(mMapHandle);
        if (mDataPtr)
            UnmapViewOfFile(mDataPtr);
    }
    SharedMemoryLock(SharedMemoryLock&& other) : mMapHandle(std::exchange(other.mMapHandle, nullptr)), mWaitEventHandle(std::exchange(other.mWaitEventHandle, nullptr)) ,
        mDataPtr(std::exchange(other.mDataPtr, nullptr)) {}
    SharedMemoryLock& operator=(SharedMemoryLock&& other) {
        std::swap(mMapHandle, other.mMapHandle);
        std::swap(mWaitEventHandle, other.mWaitEventHandle);
        std::swap(mDataPtr, other.mDataPtr);
        return *this;
    }
private:
    struct LockData {
        volatile LONG waiters;
        volatile LONG busy;
    };
    SharedMemoryLock() = default;
    bool Init() {
        mMapHandle = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, (DWORD)sizeof(LockData), "LMU_SharedMemoryLockData");
        if (!mMapHandle) {
            return false;
        }
        mDataPtr = (LockData*)MapViewOfFile(mMapHandle, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(LockData));
        if (!mDataPtr) {
            CloseHandle(mMapHandle);
            return false;
        }
        if (GetLastError() != ERROR_ALREADY_EXISTS) {
            Reset();
        }
        mWaitEventHandle = CreateEventA(NULL, FALSE, FALSE, "LMU_SharedMemoryLockEvent");
        if (!mWaitEventHandle) {
            UnmapViewOfFile(mDataPtr);
            CloseHandle(mMapHandle);
            return false;
        }
        return true;
    }
    HANDLE mMapHandle = NULL;
    HANDLE mWaitEventHandle = NULL;
    LockData* mDataPtr = nullptr;
};

struct SharedMemoryScoringData { // Remember to check CopySharedMemoryObj still works properly when updating this struct
    ScoringInfoV01 scoringInfo;
    size_t scoringStreamSize;
    VehicleScoringInfoV01 vehScoringInfo[104]; // MUST NOT BE MOVED!
    char scoringStream[65536];
};

struct SharedMemoryTelemetryData { // Remember to check CopySharedMemoryObj still works properly when updating this struct
    uint8_t activeVehicles;
    uint8_t playerVehicleIdx;
    bool playerHasVehicle;
    TelemInfoV01 telemInfo[104];
};

struct SharedMemoryPathData {
    char userData[MAX_PATH];
    char customVariables[MAX_PATH];
    char stewardResults[MAX_PATH];
    char playerProfile[MAX_PATH];
    char pluginsFolder[MAX_PATH];
};

struct SharedMemoryGeneric {
    SharedMemoryEvent events[SharedMemoryEvent::SME_MAX];       // queue of events
    long gameVersion;
    float FFBTorque;
    ApplicationStateV01 appInfo;
};

struct SharedMemoryObjectOut { // Remember to check CopySharedMemoryObj still works properly when updating this struct
    SharedMemoryGeneric generic;
    SharedMemoryPathData paths;
    SharedMemoryScoringData scoring;
    SharedMemoryTelemetryData telemetry;
};

struct SharedMemoryLayout {
    SharedMemoryObjectOut data;
};

static void CopySharedMemoryObj(SharedMemoryObjectOut& dst, SharedMemoryObjectOut& src) {
    memcpy(&dst.generic, &src.generic, sizeof(SharedMemoryGeneric));
    bool copyScoring = false;
    bool copyTelemetry = false;
    bool copyPaths = false;
    for (uint32_t i = 0; i < SharedMemoryEvent::SME_MAX; ++i) {
        switch(src.generic.events[i])
        {
        case SME_UPDATE_SCORING:  
            copyScoring = true;
            break;
        case SME_UPDATE_TELEMETRY:
            copyTelemetry = true;
            break;
        case SME_ENTER:
        case SME_EXIT:
        case SME_SET_ENVIRONMENT:
            copyPaths = true;
            break;
        default:
            break;
        }
    }

    if (copyScoring) {
        memcpy(&dst.scoring.scoringInfo, &src.scoring.scoringInfo, sizeof(ScoringInfoV01));
        memcpy(&dst.scoring.vehScoringInfo, &src.scoring.vehScoringInfo, src.scoring.scoringInfo.mNumVehicles * sizeof(VehicleScoringInfoV01));
        memcpy(&dst.scoring.scoringStream, &src.scoring.scoringStream, src.scoring.scoringStreamSize);
        dst.scoring.scoringStreamSize = src.scoring.scoringStreamSize;
        dst.scoring.scoringStream[dst.scoring.scoringStreamSize] = '\0';
        dst.scoring.scoringInfo.mVehicle = &dst.scoring.vehScoringInfo[0];
        dst.scoring.scoringInfo.mResultsStream = &dst.scoring.scoringStream[0];
    }
    if (copyTelemetry) {
        dst.telemetry.activeVehicles = src.telemetry.activeVehicles;
        dst.telemetry.playerHasVehicle = src.telemetry.playerHasVehicle;
        dst.telemetry.playerVehicleIdx = src.telemetry.playerVehicleIdx;
        memcpy(&dst.telemetry.telemInfo, &src.telemetry.telemInfo, src.telemetry.activeVehicles * sizeof(TelemInfoV01));
    }
    if (copyPaths) {
        memcpy(&dst.paths, &src.paths, sizeof(SharedMemoryPathData));
    }
}
