import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ContractFunctionParameters } from 'viem';
import { useAccount, useConnect } from 'wagmi';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useValue } from '../../internal/hooks/useValue';
import type { LifecycleStatus } from '../../transaction';
import {
  GENERIC_ERROR_MESSAGE,
  USER_REJECTED_ERROR,
} from '../../transaction/constants';
import { useCallsStatus } from '../../transaction/hooks/useCallsStatus';
import { useWriteContracts } from '../../transaction/hooks/useWriteContracts';
import { isUserRejectedRequestError } from '../../transaction/utils/isUserRejectedRequestError';
import { useCommerceContracts } from '../hooks/useCommerceContracts';

type PayContextType = {
  errorMessage?: string;
  lifeCycleStatus?: LifecycleStatus;
  onSubmit: () => void;
  setLifecycleStatus: (status: LifecycleStatus) => void;
};

const emptyContext = {} as PayContextType;
export const PayContext = createContext<PayContextType>(emptyContext);

export function usePayContext() {
  const context = useContext(PayContext);
  if (context === emptyContext) {
    throw new Error('usePayContext must be used within a Pay component');
  }
  return context;
}

export function PayProvider({
  chainId,
  chargeId,
  children,
  className,
  onStatus,
}: {
  chainId: number;
  chargeId: string;
  children: React.ReactNode;
  className?: string;
  onStatus?: (status: LifecycleStatus) => void;
}) {
  // Core hooks
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect({
    mutation: {
      onSuccess: async () => {
        await fetchContracts();
      },
    },
  });
  const contractsRef = useRef<ContractFunctionParameters[] | undefined>(
    undefined,
  );
  const userHasInsufficientBalanceRef = useRef<boolean>(false);
  const [transactionId, setTransactionId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Component lifecycle
  const [lifeCycleStatus, setLifecycleStatus] = useState<LifecycleStatus>({
    statusName: 'init',
    statusData: null,
  });

  // Transaction hooks
  const fetchContracts = useCommerceContracts({
    address,
    chargeId,
    contractsRef,
    setErrorMessage,
    userHasInsufficientBalanceRef,
  });
  const { status, writeContractsAsync } = useWriteContracts({
    setLifecycleStatus,
    setTransactionId,
  });
  const { transactionHash, status: callStatus } = useCallsStatus({
    setLifecycleStatus,
    transactionId,
  });
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: transactionHash,
  });

  // Component lifecycle emitters
  useEffect(() => {
    // Emit Status
    onStatus?.(lifeCycleStatus);
  }, [
    lifeCycleStatus,
    lifeCycleStatus.statusData, // Keep statusData, so that the effect runs when it changes
    lifeCycleStatus.statusName, // Keep statusName, so that the effect runs when it changes
    onStatus,
  ]);

  // Set transaction pending status when writeContracts is pending
  useEffect(() => {
    if (status === 'pending') {
      setLifecycleStatus({
        statusName: 'transactionPending',
        statusData: null,
      });
    }
  }, [status]);
  // Trigger success status when receipt is generated by useWaitForTransactionReceipt
  useEffect(() => {
    if (!receipt) {
      return;
    }
    setLifecycleStatus({
      statusName: 'success',
      statusData: {
        transactionReceipts: [receipt],
      },
    });
  }, [receipt]);

  const handleSubmit = useCallback(async () => {
    try {
      if (lifeCycleStatus.statusName === 'success') {
        // Open Coinbase Commerce receipt
        window.open(
          `https://commerce.coinbase.com/pay/${chargeId}/receipt`,
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      if (
        lifeCycleStatus.statusName === 'error' &&
        lifeCycleStatus.statusData?.error === 'User has insufficient balance'
      ) {
        window.open(
          'https://keys.coinbase.com/fund',
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }

      if (isConnected) {
        // Fetch contracts
        await fetchContracts();
      } else {
        // Prompt for wallet connection
        // TODO: This should hardcode to Smart Wallet
        await connectAsync({ connector: connectors[0] });
      }

      // Check for enough balance
      if (userHasInsufficientBalanceRef.current) {
        console.error('User has insufficient balance');
        setLifecycleStatus({
          statusName: 'error',
          statusData: {
            code: 'insufficient_balance', // Pay module PayProvider component 00 error
            error: 'User has insufficient balance',
            message: 'User has insufficient balance',
          },
        });
        return;
      }

      if (contractsRef.current) {
        await writeContractsAsync({
          contracts: contractsRef.current,
        });
      } else {
        console.error('Contracts are not available');
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        setLifecycleStatus({
          statusName: 'error',
          statusData: {
            code: 'PmPPc01', // Pay module PayProvider component 01 error
            error: 'Contracts are not available',
            message: GENERIC_ERROR_MESSAGE,
          },
        });
      }
    } catch (error) {
      if (isUserRejectedRequestError(error)) {
        setErrorMessage(USER_REJECTED_ERROR);
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        setLifecycleStatus({
          statusName: 'error',
          statusData: {
            code: 'PmPPc02', // Pay module PayProvider component 02 error
            error: JSON.stringify(error),
            message: GENERIC_ERROR_MESSAGE,
          },
        });
      }
    }
  }, [
    chargeId,
    connectAsync,
    connectors,
    isConnected,
    lifeCycleStatus.statusData,
    lifeCycleStatus.statusName,
    fetchContracts,
    writeContractsAsync,
  ]);

  const value = useValue({
    errorMessage,
    lifeCycleStatus,
    onSubmit: handleSubmit,
    setLifecycleStatus,
  });
  return <PayContext.Provider value={value}>{children}</PayContext.Provider>;
}
